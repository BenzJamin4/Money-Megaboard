import os
import json
import csv
import re
import pandas as pd
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_file

app = Flask(__name__)

# Constants and Storage
_APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(_APP_DIR, "app_data.json")

# Injected Context for Standalone Mode
@app.context_processor
def inject_standalone_version():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        versions_dir = os.path.abspath(os.path.join(base_dir, ".."))
        # Get all subfolders starting with 'v' inside the versions directory
        all_v = [d for d in os.listdir(versions_dir) if d.startswith('v') and os.path.isdir(os.path.join(versions_dir, d))]
        all_v.sort() # Ensure they are alphabetically sorted (v3.4.9 < v4.0.1)
    except Exception:
        all_v = [os.path.basename(os.path.dirname(os.path.abspath(__file__)))]

    return dict(
        all_versions=all_v,
        active_version=os.path.basename(os.path.dirname(os.path.abspath(__file__)))
    )

INCOME_CATS = ["Income", "Dividends", "Transfers", "Other"]
EXPENSE_CATS = ["Food", "Transportation", "Shopping", "Education", "Subscription", "Entertainment", "Clothes+Haircuts", "Health", "Transfers", "Other"]
PAYPAL_AUTH_TYPES = {"general authorization", "reauthorization"}
PAYPAL_ALWAYS_REMOVE_TYPES = {
    "reversal of general account hold": "REMOVED: PayPal Hold Reversal",
    "general hold": "REMOVED: PayPal Hold",
    "general hold release": "REMOVED: PayPal Hold Release",
}
PAYPAL_FUNDING_TYPES = {"general card deposit", "bank deposit to pp account"}
PAYPAL_SETTLED_MERCHANT_TYPES = {
    "general paypal debit card transaction",
    "preapproved payment bill user payment",
    "express checkout payment",
    "mobile payment",
    "donation payment",
}
PAYPAL_HELPER_COLUMNS = [
    "_Timestamp",
    "_Amount_Num",
    "_Abs_Amount",
    "_Type_Key",
    "_Status_Key",
    "_Name_Key",
    "_Is_PayPal_Name",
]


def load_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r') as f:
                return json.load(f)
        except (PermissionError, OSError):
            # File exists but can't be read (quarantine) — remove it
            try:
                os.remove(DATA_FILE)
            except Exception:
                pass
    return {
        "customCategories": {},
        "isolatedTxs": {},
        "csvMappings": {},
        "customNotes": {},
        "transferRules": []
    }

def save_data(data):
    try:
        with open(DATA_FILE, 'w') as f:
            json.dump(data, f, indent=4)
    except PermissionError:
        # File has quarantine attributes — delete and recreate
        try:
            os.remove(DATA_FILE)
        except Exception:
            pass
        with open(DATA_FILE, 'w') as f:
            json.dump(data, f, indent=4)


def parse_amount(val_str):
    if not val_str: return 0.0
    val_str = str(val_str)
    # Check for negative explicitly indicated by - or ()
    is_neg = '-' in val_str or ('(' in val_str and ')' in val_str)
    # Strip everything but numbers and decimal point
    clean_val = re.sub(r'[^0-9.]', '', val_str)
    try:
        val = float(clean_val)
        return -abs(val) if is_neg else abs(val)
    except ValueError:
        return 0.0

def paypal_name_key(value):
    if pd.isna(value):
        return ""
    return re.sub(r'\s+', ' ', str(value)).strip().casefold()

def paypal_is_paypal_actor(name_key):
    return name_key in {"paypal", "paypal inc", "paypal inc."}

def mark_paypal_removed(master_df, mask, reason):
    active_mask = mask & master_df['Status_Debug'].eq('KEEP')
    master_df.loc[active_mask, 'Status_Debug'] = reason

def normalize_paypal_dataframe(df):
    master_df = df.copy()

    if 'Name' not in master_df.columns:
        for col in ['Recipient', 'Recipient Name']:
            if col in master_df.columns:
                master_df['Name'] = master_df[col]
                break
        else:
            master_df['Name'] = ""

    if 'Amount' not in master_df.columns:
        for col in ['Net', 'Gross']:
            if col in master_df.columns:
                master_df['Amount'] = master_df[col]
                break
        else:
            master_df['Amount'] = 0

    for col in ['Date', 'Time', 'Type', 'Status', 'Transaction ID']:
        if col not in master_df.columns:
            master_df[col] = ""

    master_df['Name'] = master_df['Name'].fillna("")
    master_df['Type'] = master_df['Type'].fillna("")
    master_df['Status'] = master_df['Status'].fillna("")
    master_df['Transaction ID'] = master_df['Transaction ID'].fillna("")

    timestamp_source = (
        master_df['Date'].fillna("").astype(str).str.strip() + " " +
        master_df['Time'].fillna("").astype(str).str.strip()
    ).str.strip()

    master_df['_Timestamp'] = pd.to_datetime(timestamp_source, errors='coerce')
    master_df['_Amount_Num'] = master_df['Amount'].apply(parse_amount)
    master_df['_Abs_Amount'] = master_df['_Amount_Num'].abs()
    master_df['_Type_Key'] = master_df['Type'].astype(str).str.strip().str.casefold()
    master_df['_Status_Key'] = master_df['Status'].astype(str).str.strip().str.casefold()
    master_df['_Name_Key'] = master_df['Name'].apply(paypal_name_key)
    master_df['_Is_PayPal_Name'] = master_df['_Name_Key'].apply(paypal_is_paypal_actor)
    master_df['Status_Debug'] = 'KEEP'

    return master_df

def paypal_group_has_settled_partner(keep_rows, row_idx, row):
    same_name_mask = keep_rows['_Name_Key'].eq(row['_Name_Key'])
    same_amount_mask = keep_rows['_Abs_Amount'].eq(row['_Abs_Amount'])
    settled_mask = keep_rows['_Type_Key'].isin(PAYPAL_SETTLED_MERCHANT_TYPES)
    return ((keep_rows.index != row_idx) & same_name_mask & same_amount_mask & settled_mask).any()

def paypal_group_has_funding_partner(keep_rows, row_idx, row):
    settled_spend_mask = (
        keep_rows['_Type_Key'].isin(PAYPAL_SETTLED_MERCHANT_TYPES) &
        keep_rows['_Amount_Num'].lt(0) &
        keep_rows['_Abs_Amount'].eq(row['_Abs_Amount'])
    )
    return ((keep_rows.index != row_idx) & settled_spend_mask).any()

def paypal_group_has_auth_noise(group_rows, row_idx, row):
    noise_types = PAYPAL_AUTH_TYPES | {"void of authorization", "reversal of general account hold"}
    same_amount_mask = group_rows['_Abs_Amount'].eq(row['_Abs_Amount'])
    noise_mask = group_rows['_Type_Key'].isin(noise_types)
    return ((group_rows.index != row_idx) & same_amount_mask & noise_mask).any()

def clean_paypal_history_frame(df):
    master_df = normalize_paypal_dataframe(df)

    mark_paypal_removed(
        master_df,
        ~master_df['_Status_Key'].eq('completed'),
        'REMOVED: Not Completed'
    )

    for type_key, reason in PAYPAL_ALWAYS_REMOVE_TYPES.items():
        mark_paypal_removed(master_df, master_df['_Type_Key'].eq(type_key), reason)

    mark_paypal_removed(
        master_df,
        master_df['_Is_PayPal_Name'] & master_df['_Amount_Num'].eq(0),
        'REMOVED: Zero Amount PayPal Noise'
    )

    mark_paypal_removed(
        master_df,
        master_df['_Type_Key'].isin(PAYPAL_AUTH_TYPES) & master_df['_Name_Key'].eq(""),
        'REMOVED: Empty Authorization'
    )

    duplicate_id_mask = (
        master_df['Transaction ID'].astype(str).str.strip().ne("") &
        master_df.duplicated(subset=['Transaction ID'], keep='first')
    )
    mark_paypal_removed(master_df, duplicate_id_mask, 'REMOVED: Duplicate Transaction ID')

    grouped_rows = master_df.loc[master_df['_Timestamp'].notna()].groupby('_Timestamp', sort=False)
    for _, group_rows in grouped_rows:
        keep_rows = group_rows[group_rows['Status_Debug'].eq('KEEP')]
        if keep_rows.empty:
            continue

        paypal_other_rows = keep_rows[
            keep_rows['_Type_Key'].eq('other') & keep_rows['_Is_PayPal_Name']
        ]
        for idx, row in paypal_other_rows.iterrows():
            if paypal_group_has_auth_noise(group_rows, idx, row):
                master_df.at[idx, 'Status_Debug'] = 'REMOVED: PayPal Authorization Noise'

        keep_rows = master_df.loc[group_rows.index]
        keep_rows = keep_rows[keep_rows['Status_Debug'].eq('KEEP')]

        funding_rows = keep_rows[keep_rows['_Type_Key'].isin(PAYPAL_FUNDING_TYPES)]
        for idx, row in funding_rows.iterrows():
            if paypal_group_has_funding_partner(keep_rows, idx, row):
                master_df.at[idx, 'Status_Debug'] = 'REMOVED: Funding Leg for Settled Charge'

        keep_rows = master_df.loc[group_rows.index]
        keep_rows = keep_rows[keep_rows['Status_Debug'].eq('KEEP')]

        auth_rows = keep_rows[keep_rows['_Type_Key'].isin(PAYPAL_AUTH_TYPES)]
        for idx, row in auth_rows.iterrows():
            if paypal_group_has_settled_partner(keep_rows, idx, row):
                master_df.at[idx, 'Status_Debug'] = 'REMOVED: Merchant Authorization Paired to Settled Charge'

    return master_df

def build_paypal_exports(df):
    master_df = clean_paypal_history_frame(df)
    master_df = master_df.sort_values(
        by=['_Timestamp', 'Date', 'Time'],
        ascending=False,
        na_position='last',
        kind='stable'
    )

    debug_export = master_df.drop(columns=PAYPAL_HELPER_COLUMNS, errors='ignore').fillna("")
    clean_df = master_df[master_df['Status_Debug'] == 'KEEP'].copy()
    clean_export = clean_df.drop(columns=PAYPAL_HELPER_COLUMNS + ['Status_Debug'], errors='ignore').fillna("")
    return clean_export, debug_export

def normalize_desc(desc):
    return re.sub(r'[0-9]', '', desc).strip().lower()

def guess_category(desc, amount, custom_categories):
    norm = normalize_desc(desc)
    if norm in custom_categories:
        return custom_categories[norm]
        
    d = desc.lower()
    
    def has_word(word):
        return re.search(rf'\b{word}\b', d) is not None
        
    if "transfer" in d or "zelle" in d or "venmo" in d: return "Transfers"
    if "deposit" in d or "payroll" in d or "salary" in d: return "Income"
    if "dividend" in d or "interest" in d: return "Dividends"
    if "wawa" in d or "restaurant" in d or "pizza" in d or "mcdonald" in d or "starbucks" in d or has_word("applebee") or "sheetz" in d or "market" in d or "wegmans" in d or "giant" in d or "aldi" in d: return "Food"
    if "uber" in d or "lyft" in d or has_word("gas") or "sunoco" in d: return "Transportation"
    if "amazon" in d or "target" in d or "walmart" in d: return "Shopping"
    if has_word("psu") or "tuition" in d or "cengage" in d: return "Education"
    if "netflix" in d or "spotify" in d or has_word("apple") or has_word("prime") or "hulu" in d or has_word("amc"): return "Entertainment"
    if has_word("cvs") or "pharmacy" in d or "doctor" in d or "hospital" in d: return "Health"
    if "hair" in d or "barber" in d or "clothes" in d or "apparel" in d or "nike" in d or "h&m" in d: return "Clothes+Haircuts"
    
    return "Income" if amount > 0 else "Other"




def apply_transfer_rules(transactions, rules):
    # Reset states
    for tx in transactions:
        tx['isTransfer'] = False
        tx['isHidden'] = False
        tx['transferPartnerTxId'] = None

    if rules is None: rules = []
    
    existing_accounts = set(t['account'].lower() for t in transactions)
    
    for i in range(len(transactions)):
        t1 = transactions[i]
        if t1['isTransfer']: continue
        
        matched_pair = False
        
        for j in range(len(transactions)):
            if i == j: continue
            t2 = transactions[j]
            if t2['isTransfer']: continue
            
            # Check for opposites
            if (t1['amount'] > 0 and t2['amount'] > 0) or (t1['amount'] < 0 and t2['amount'] < 0): continue
            if abs(t1['amount']) != abs(t2['amount']): continue
            
            # Date logic
            try:
                d1 = datetime.fromisoformat(t1['date'].replace('Z', '+00:00'))
                d2 = datetime.fromisoformat(t2['date'].replace('Z', '+00:00'))
                days_apart = abs((d1 - d2).days)
            except Exception:
                continue
            
            rule_matched = False
            for rule in rules:
                if not rule.get('acc1') or not rule.get('acc2'): continue
                if days_apart > int(rule.get('days', 3)): continue
                
                matchA = (rule['acc1'].lower() in t1['account'].lower() and rule['desc1'].lower() in t1['desc'].lower() and
                          rule['acc2'].lower() in t2['account'].lower() and rule['desc2'].lower() in t2['desc'].lower())
                matchB = (rule['acc1'].lower() in t2['account'].lower() and rule['desc1'].lower() in t2['desc'].lower() and
                          rule['acc2'].lower() in t1['account'].lower() and rule['desc2'].lower() in t1['desc'].lower())
                
                if matchA or matchB:
                    rule_matched = True
                    break
                    
            if rule_matched or (days_apart <= 3 and t1['account'] != t2['account']):
                t1['isTransfer'] = True
                t2['isTransfer'] = True
                t1['transferPartnerTxId'] = t2['id']
                t2['transferPartnerTxId'] = t1['id']
                
                if t1['amount'] > 0: t1['isHidden'] = True
                if t2['amount'] > 0: t2['isHidden'] = True
                
                t1['category'] = "Transfers"
                t2['category'] = "Transfers"
                matched_pair = True
                break

        # Check for Ghost CSVs if no internal pair was found
        if not matched_pair:
            t1_acc = t1['account'].lower()
            t1_desc = t1['desc'].lower()
            
            for rule in rules:
                if not rule.get('acc1') or not rule.get('acc2'): continue
                
                # Match A: t1 matches acc1 side, so acc2 is missing
                if rule['acc1'].lower() in t1_acc and rule['desc1'].lower() in t1_desc:
                    if rule['acc2'] not in existing_accounts:
                        t1['isTransfer'] = True
                        t1['category'] = "Transfers"
                        t1['transferPartnerAccount'] = f"👻{rule['acc2']}"
                        break
                        
                # Match B: t1 matches acc2 side, acc1 is missing
                elif rule['acc2'].lower() in t1_acc and rule['desc2'].lower() in t1_desc:
                    if rule['acc1'] not in existing_accounts:
                        t1['isTransfer'] = True
                        t1['category'] = "Transfers"
                        t1['transferPartnerAccount'] = f"👻{rule['acc1']}"
                        break


# --- ROUTES ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/readme', methods=['GET'])
def get_readme():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        readme_path = os.path.abspath(os.path.join(base_dir, "..", "..", "..", "README.md"))
        if os.path.exists(readme_path):
            with open(readme_path, "r", encoding="utf-8") as f:
                return jsonify({"content": f.read()})
        return jsonify({"content": f"README.md not found at {readme_path}"})
    except Exception as e:
        return jsonify({"content": f"Error reading README.md: {str(e)}"})

@app.route('/api/switch-version', methods=['POST'])
def switch_version():
    data = request.json
    target_version = data.get('version')
    if not target_version:
        return jsonify({"error": "No version provided"}), 400
        
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        shared_dir = os.path.abspath(os.path.join(base_dir, "..", "..", "shared"))
        
        # 1. Write the intended version string to the Active Version tracker file
        act_ver_path = os.path.join(shared_dir, "active_version.txt")
        with open(act_ver_path, "w") as f:
            f.write(target_version)
            
        # 2. Write the restart flag to tell the Mac Native Wrapper loop to repeat instead of quitting
        restart_path = os.path.join(shared_dir, "restart_flag")
        with open(restart_path, "w") as f:
            f.write("true")
            
        # 3. Natively crash this process securely so the pywebview window dies instantly and hands execution back to the `.app` shell wrapper
        import threading
        def hard_kill():
            import time
            time.sleep(0.5)
            import os
            os._exit(0)
        
        threading.Thread(target=hard_kill).start()
        
        return jsonify({"status": "restarting"})
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    if request.method == 'POST':
        new_data = request.json
        save_data(new_data)
        return jsonify({"status": "success"})
    else:
        return jsonify(load_data())


@app.route('/api/process', methods=['POST'])
def process_data():
    payload = request.json
    groups = payload.get('groups', [])
    
    app_data = load_data()
    custom_categories = app_data.get('customCategories', {})
    isolated = app_data.get('isolatedTxs', {})
    csv_mappings = app_data.get('csvMappings', {})
    custom_notes = app_data.get('customNotes', {})
    rules = app_data.get('transferRules', [])
    
    parsed_transactions = []
    
    for group in groups:
        map_conf = csv_mappings.get(group['mappingKey'], {})
        
        for file_data in group.get('filesData', []):
            account_name = file_data.get('accountName', 'Unknown')
            rows = file_data.get('rows', [])
            
            if not rows or len(rows) == 0:
                continue
            
            # Use this file's own header row for index computation
            headers = rows[0]
            
            def get_idx(key):
                try:
                    val = map_conf.get(key)
                    if isinstance(val, list): return -1
                    return headers.index(val) if val else -1
                except ValueError:
                    return -1
                    
            def get_idx_list(key):
                val = map_conf.get(key)
                if not val: return []
                if isinstance(val, list):
                    return [headers.index(v) for v in val if v in headers]
                elif val in headers:
                    return [headers.index(val)]
                return []
                    
            d_indices = get_idx_list('date')
            ds_indices = get_idx_list('desc')
            a_indices = get_idx_list('amount')
            dr_idx = get_idx('debit')
            cr_idx = get_idx('credit')
            n_indices = get_idx_list('notes')
            
            status_idx = next((i for i, h in enumerate(headers) if h.lower() == 'status'), -1)
            type_idx = next((i for i, h in enumerate(headers) if h.lower() == 'type'), -1)
            
            # Start at index 1 to skip header
            for i in range(1, len(rows)):
                cols = rows[i]
                if not cols or len(cols) == 0 or (len(cols) == 1 and cols[0].strip() == ""): continue
                
                # Check status
                if status_idx != -1 and len(cols) > status_idx:
                    stat = str(cols[status_idx]).lower()
                    if stat in ["pending", "denied", "canceled"]: continue
                
                # Check type
                if type_idx != -1 and len(cols) > type_idx:
                    typ = str(cols[type_idx]).lower()
                    if any(x in typ for x in ["shopping cart item", "authorization", "hold", "currency conversion"]): continue
                
                if not d_indices: continue
                
                date_parts = []
                for idx in d_indices:
                    if len(cols) > idx and cols[idx]:
                        part = str(cols[idx]).strip()
                        if part:
                            date_parts.append(part)
                
                if not date_parts: continue
                raw_date = " ".join(date_parts)
                    
                dt = None
                try:
                    from dateutil import parser, tz
                    tz_dict = {
                        "EST": -5*3600, "EDT": -4*3600, "ET": -5*3600,
                        "CST": -6*3600, "CDT": -5*3600, "CT": -6*3600,
                        "MST": -7*3600, "MDT": -6*3600, "MT": -7*3600,
                        "PST": -8*3600, "PDT": -7*3600, "PT": -8*3600,
                        "UTC": 0, "GMT": 0
                    }
                    dt = parser.parse(raw_date, tzinfos=tz_dict)
                    
                    # Convert to East Coast Time natively
                    eastern = tz.gettz('America/New_York')
                    if dt.tzinfo is not None:
                        # Convert aware datetime to Eastern
                        dt = dt.astimezone(eastern)
                    else:
                        # Assume naive is local or UTC; just force it to Eastern wall time conceptually
                        # Or if we want it to literally represent the string as Eastern time:
                        dt = dt.replace(tzinfo=eastern)
                        
                    # Strip tzinfo so it serializes strictly as a naive ISO string representing the local east coast wall clock
                    dt = dt.replace(tzinfo=None)
                except Exception:
                    continue # skip if invalid date
                
                amt = 0.0
                if a_indices:
                    if len(a_indices) == 1:
                        idx = a_indices[0]
                        if len(cols) > idx and cols[idx]:
                            amt = parse_amount(cols[idx])
                    elif len(a_indices) >= 2:
                        dr_idx_multi = a_indices[0]
                        cr_idx_multi = a_indices[1]
                        c_val = parse_amount(cols[cr_idx_multi]) if (len(cols) > cr_idx_multi and cols[cr_idx_multi]) else 0.0
                        d_val = parse_amount(cols[dr_idx_multi]) if (len(cols) > dr_idx_multi and cols[dr_idx_multi]) else 0.0
                        amt = c_val - d_val
                else:
                    c_val = parse_amount(cols[cr_idx]) if (cr_idx != -1 and len(cols) > cr_idx and cols[cr_idx]) else 0.0
                    d_val = parse_amount(cols[dr_idx]) if (dr_idx != -1 and len(cols) > dr_idx and cols[dr_idx]) else 0.0
                    amt = c_val - d_val
                    
                raw_desc_parts = []
                for idx in ds_indices:
                    if len(cols) > idx and cols[idx]:
                        part = str(cols[idx]).strip()
                        if part: raw_desc_parts.append(part)
                raw_desc = ", ".join(raw_desc_parts)
                norm_desc = normalize_desc(raw_desc)
                
                safe_desc = re.sub(r'[^a-zA-Z0-9]', '', raw_desc)
                tx_id = f"{int(dt.timestamp() * 1000)}_{amt}_{safe_desc}"
                
                cat = guess_category(raw_desc, amt, custom_categories)
                is_isolated = False
                manual_transfer_account = None
                
                if tx_id in isolated:
                    cat = isolated[tx_id].get('category', cat)
                    is_isolated = isolated[tx_id].get('isolate', False)
                    manual_transfer_account = isolated[tx_id].get('manualTransferAccount', None)
                    
                note_val = custom_notes.get(tx_id, "")
                if not note_val and n_indices:
                    parts = []
                    for idx in n_indices:
                        if len(cols) > idx and str(cols[idx]).strip():
                            parts.append(str(cols[idx]).strip())
                    note_val = ", ".join(parts)
                    
                tx_data = {
                    "id": tx_id,
                    "date": dt.isoformat(),
                    "desc": raw_desc,
                    "normalizedDesc": norm_desc,
                    "amount": amt,
                    "notes": note_val,
                    "category": cat,
                    "originalCategory": guess_category(raw_desc, amt, custom_categories),
                    "account": account_name,
                    "isTransfer": bool(manual_transfer_account),
                    "isHidden": False,
                    "isolate": is_isolated,
                    "transferPartnerTxId": None
                }
                
                if manual_transfer_account:
                    tx_data["manualTransferAccount"] = manual_transfer_account
                    tx_data["transferPartnerAccount"] = manual_transfer_account
                    
                parsed_transactions.append(tx_data)
                
    # Sort backwards by date
    parsed_transactions.sort(key=lambda x: x['date'], reverse=True)
    
    # Auto Transfer Links
    apply_transfer_rules(parsed_transactions, rules)

    return jsonify({"transactions": parsed_transactions})


@app.route('/api/upload_paypal', methods=['POST'])
def upload_paypal():
    files = request.files.getlist('files')
    if not files:
        return jsonify({"error": "No file part"}), 400

    # Read all uploaded CSVs
    dfs = []
    for f in files:
        if f.filename != '':
            dfs.append(pd.read_csv(f, index_col=None, header=0, low_memory=False))
            
    if not dfs:
        return jsonify({"error": "No selected files"}), 400
        
    df = pd.concat(dfs, ignore_index=True)
    clean_export, debug_export = build_paypal_exports(df)
    
    # Save the debug log
    debug_path = os.path.join('static', 'downloads', 'PayPal_DEBUG_LOG.csv')
    os.makedirs(os.path.dirname(debug_path), exist_ok=True)
    debug_export.to_csv(debug_path, index=False)

    # Save the cleaned master
    master_path = os.path.join('static', 'downloads', 'PayPal_Master_History.csv')
    clean_export.to_csv(master_path, index=False)
    
    # Return cleaned rows as a 2D array [ [header], [row1], [row2] ] for JS parsing
    cleaned_rows = [clean_export.columns.tolist()] + clean_export.values.tolist()
    
    return jsonify({
        "status": "success",
        "cleaned_rows": cleaned_rows
    })


@app.route('/api/clear', methods=['POST'])
def clear_data():
    save_data({
        "customCategories": {},
        "isolatedTxs": {},
        "csvMappings": {},
        "customNotes": {},
        "transferRules": []
    })
    
    try:
        if os.path.exists(os.path.join('static', 'downloads', 'PayPal_DEBUG_LOG.csv')):
            os.remove(os.path.join('static', 'downloads', 'PayPal_DEBUG_LOG.csv'))
        if os.path.exists(os.path.join('static', 'downloads', 'PayPal_Master_History.csv')):
            os.remove(os.path.join('static', 'downloads', 'PayPal_Master_History.csv'))
    except Exception as e:
        print("Error removing files:", e)
        pass

    return jsonify({"status": "success"})


if __name__ == '__main__':
    app.run(debug=True, port=5050)
