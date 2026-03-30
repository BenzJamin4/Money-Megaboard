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

# Injected Context for Standalone Mode (run via `python app.py` directly)
@app.context_processor
def inject_standalone_version():
    return dict(
        all_versions=[os.path.basename(_APP_DIR)],
        active_version=os.path.basename(_APP_DIR)
    )

INCOME_CATS = ["Income", "Dividends", "Transfers", "Other"]
EXPENSE_CATS = ["Food", "Transportation", "Shopping", "Education", "Subscription", "Entertainment", "Clothes+Haircuts", "Health", "Transfers", "Other"]


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


def split_csv_row(row_text):
    # Basic CSV row splitter respecting quotes. Python csv module handles this,
    # but since data arrives via fetch, we might just parse it via dict reader instead.
    pass


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
                        t1['transferPartnerAccount'] = rule['acc2']
                        break
                        
                # Match B: t1 matches acc2 side, acc1 is missing
                elif rule['acc2'].lower() in t1_acc and rule['desc2'].lower() in t1_desc:
                    if rule['acc1'] not in existing_accounts:
                        t1['isTransfer'] = True
                        t1['category'] = "Transfers"
                        t1['transferPartnerAccount'] = rule['acc1']
                        break


# --- ROUTES ---

@app.route('/')
def index():
    return render_template('index.html')


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
                    
            d_idx = get_idx('date')
            t_idx = get_idx('time')
            ds_idx = get_idx('desc')
            a_idx = get_idx('amount')
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
                
                if d_idx == -1 or len(cols) <= d_idx or not cols[d_idx]: continue
                
                raw_date = str(cols[d_idx]).strip()
                if t_idx != -1 and len(cols) > t_idx and str(cols[t_idx]).strip():
                    raw_time = str(cols[t_idx]).strip()
                    # Clean out generic formatting anomalies like GMT tag if it's there
                    raw_time = raw_time.replace("ET", "").replace("EST", "").replace("EDT", "").replace("PST", "").replace("PDT", "").strip()
                    raw_date = f"{raw_date} {raw_time}"
                    
                dt = None
                try:
                    from dateutil import parser
                    dt = parser.parse(raw_date)
                except Exception:
                    continue # skip if invalid date
                
                amt = 0.0
                if a_idx != -1 and len(cols) > a_idx and cols[a_idx]:
                    amt = parse_amount(cols[a_idx])
                else:
                    c_val = parse_amount(cols[cr_idx]) if (cr_idx != -1 and len(cols) > cr_idx and cols[cr_idx]) else 0.0
                    d_val = parse_amount(cols[dr_idx]) if (dr_idx != -1 and len(cols) > dr_idx and cols[dr_idx]) else 0.0
                    amt = c_val - d_val
                    
                raw_desc = cols[ds_idx] if (ds_idx != -1 and len(cols) > ds_idx) else ""
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
    
    # Standardize names for debug output
    name_cols = ['Name', 'Recipient', 'Recipient Name']
    amt_cols = ['Amount', 'Net', 'Gross']
    for col in name_cols:
        if col in df.columns: df.rename(columns={col: 'Name'}, inplace=True)
    for col in amt_cols:
        if col in df.columns: df.rename(columns={col: 'Amount'}, inplace=True)

    master_df = df.copy()
    master_df['Status_Debug'] = 'KEEP'
    
    if 'Status' in master_df.columns:
        master_df.loc[~master_df['Status'].str.contains('Completed', case=False, na=False), 'Status_Debug'] = 'REMOVED: Not Completed'

    master_df['Timestamp'] = pd.to_datetime(master_df['Date'] + ' ' + master_df['Time'])
    master_df['Abs_Amount'] = master_df['Amount'].astype(float).abs()
    
    potential_pairs = master_df[master_df['Status_Debug'] == 'KEEP']
    groups = potential_pairs.groupby(['Timestamp', 'Abs_Amount'])
    
    final_rows_indices = []
    
    for _, group in groups:
        if len(group) == 1:
            final_rows_indices.append(group.index[0])
        else:
            with_name = group[group['Name'].notna()]
            target_idx = None
            if not with_name.empty:
                negative_ones = with_name[with_name['Amount'].astype(float) < 0]
                if not negative_ones.empty:
                    if 'Type' in negative_ones.columns:
                        payments = negative_ones[~negative_ones['Type'].str.contains('Authorization', case=False, na=False)]
                        if not payments.empty:
                            target_idx = payments.index[0]
                        else:
                            target_idx = negative_ones.index[0]
                    else:
                        target_idx = negative_ones.index[0]
                else:
                    target_idx = with_name.index[0]
            else:
                target_idx = group.index[0]
                
            final_rows_indices.append(target_idx)
            
            other_indices = [idx for idx in group.index if idx != target_idx]
            master_df.loc[other_indices, 'Status_Debug'] = 'REMOVED: Duplicate/Funding Pair'

    if 'Type' in master_df.columns:
        filler_mask = (master_df['Status_Debug'] == 'KEEP') & \
                      (master_df['Type'].str.contains('Authorization', case=False, na=False)) & \
                      (master_df['Name'].isna())
        master_df.loc[filler_mask, 'Status_Debug'] = 'REMOVED: Empty Auth'

    if 'Transaction ID' in master_df.columns:
        dup_id_mask = master_df.duplicated(subset=['Transaction ID'], keep='first')
        master_df.loc[(master_df['Status_Debug'] == 'KEEP') & dup_id_mask, 'Status_Debug'] = 'REMOVED: Duplicate ID'

    master_df = master_df.sort_values(by='Timestamp', ascending=False)
    
    # Save the debug log
    debug_path = os.path.join('static', 'downloads', 'PayPal_DEBUG_LOG.csv')
    os.makedirs(os.path.dirname(debug_path), exist_ok=True)
    debug_export = master_df.drop(columns=['Timestamp', 'Abs_Amount'], errors='ignore')
    debug_export.to_csv(debug_path, index=False)

    # Save the cleaned master
    clean_df = master_df[master_df['Status_Debug'] == 'KEEP'].copy()
    clean_export = clean_df.drop(columns=['Timestamp', 'Abs_Amount', 'Status_Debug'], errors='ignore').fillna("")
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
