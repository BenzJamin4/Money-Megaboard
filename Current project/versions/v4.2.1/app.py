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
def parse_version(v_str):
    m = re.match(r'^v?(\d+)\.(\d+)\.(\d+)', v_str)
    if m:
        return tuple(map(int, m.groups()))
    return (0, 0, 0)

@app.context_processor
def inject_standalone_version():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        versions_dir = os.path.abspath(os.path.join(base_dir, ".."))
        active_ver = os.path.basename(base_dir)
        
        # Get all subfolders starting with 'v' inside the versions directory
        all_v = [d for d in os.listdir(versions_dir) if d.startswith('v') and os.path.isdir(os.path.join(versions_dir, d))]
        
        # Filter versions starting with the current major version
        active_parsed = parse_version(active_ver)
        active_maj = active_parsed[0]
        
        matched_versions = []
        for v in all_v:
            v_parsed = parse_version(v)
            if v_parsed[0] == active_maj:
                matched_versions.append((v_parsed, v))
                
        if matched_versions:
            # Group by minor version
            by_minor = {}
            for parsed, orig in matched_versions:
                minor_ver = parsed[1]
                by_minor.setdefault(minor_ver, []).append((parsed[2], orig))
                
            max_minor = max(by_minor.keys())
            filtered_v = []
            for minor_ver, patches in by_minor.items():
                if minor_ver == max_minor:
                    # Keep all patches of the latest active branch
                    for patch_ver, orig in patches:
                        filtered_v.append((minor_ver, patch_ver, orig))
                else:
                    # Keep only the highest patch version of polished branches
                    highest_patch = max(patches, key=lambda x: x[0])
                    filtered_v.append((minor_ver, highest_patch[0], highest_patch[1]))
            
            # Sort semantically (by minor version, then by patch version)
            filtered_v.sort()
            all_v = [item[2] for item in filtered_v]
        else:
            all_v = [active_ver]
    except Exception:
        all_v = [os.path.basename(os.path.dirname(os.path.abspath(__file__)))]

    # Parse changelog for active version from README.md
    active_changelog = ""
    try:
        active_ver = os.path.basename(os.path.dirname(os.path.abspath(__file__)))
        readme_path = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "README.md"))
        if os.path.exists(readme_path):
            with open(readme_path, "r", encoding="utf-8") as f:
                content = f.read()
            lines = content.splitlines()
            changelog_lines = []
            found = False
            version_header_pattern = re.compile(r'^v\d+\.\d+\.\d+')
            for line in lines:
                stripped = line.strip()
                if stripped.startswith(active_ver):
                    found = True
                    changelog_lines.append(line)
                    continue
                if found:
                    if version_header_pattern.match(stripped):
                        break
                    changelog_lines.append(line)
            if found:
                active_changelog = "\n".join(changelog_lines).strip()
            else:
                active_changelog = f"Changelog not found in README.md for version {active_ver}"
        else:
            active_changelog = f"README.md not found at {readme_path}"
    except Exception as e:
        active_changelog = f"Error parsing changelog: {str(e)}"

    return dict(
        all_versions=all_v,
        active_version=os.path.basename(os.path.dirname(os.path.abspath(__file__))),
        active_changelog=active_changelog
    )


INCOME_CATS = ["Income", "Dividends", "Transfers", "Other"]
EXPENSE_CATS = ["Food", "Transportation", "Shopping", "Education", "Subscription", "Entertainment", "Clothes+Haircuts", "Health", "Transfers", "Other"]
PAYPAL_AUTH_TYPES = {"general authorization", "reauthorization"}
PAYPAL_HOLD_REVERSAL_TYPE = "reversal of general account hold"
PAYPAL_ALWAYS_REMOVE_TYPES = {
    "general hold": "REMOVED: PayPal Hold",
    "general hold release": "REMOVED: PayPal Hold Release",
}
PAYPAL_FUNDING_TYPES = {"general card deposit", "bank deposit to pp account"}
PAYPAL_EXTERNALLY_FUNDED_PAYMENT_TYPES = {"preapproved payment bill user payment"}
PAYPAL_ALWAYS_EXTERNAL_PAYMENT_TYPES = {"express checkout payment", "donation payment"}
PAYPAL_BALANCE_EFFECTING_SETTLED_TYPES = {
    "general paypal debit card transaction",
}
PAYPAL_SETTLED_MERCHANT_TYPES = (
    PAYPAL_BALANCE_EFFECTING_SETTLED_TYPES |
    PAYPAL_EXTERNALLY_FUNDED_PAYMENT_TYPES |
    PAYPAL_ALWAYS_EXTERNAL_PAYMENT_TYPES |
    {"mobile payment"}
)
PAYPAL_HELPER_COLUMNS = [
    "_Timestamp",
    "_Amount_Num",
    "_Abs_Amount",
    "_Balance_Num",
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
        except (PermissionError, OSError) as e:
            print(f"Permission or OS error loading {DATA_FILE}: {e}")
    return {
        "customCategories": {},
        "isolatedTxs": {},
        "csvMappings": {},
        "customNotes": {},
        "transferRules": []
    }

def save_data(data):
    temp_file = DATA_FILE + ".tmp"
    try:
        # Write to temporary file first
        with open(temp_file, 'w') as f:
            json.dump(data, f, indent=4)
        # Atomically replace active file
        os.replace(temp_file, DATA_FILE)
    except (PermissionError, OSError) as e:
        # Clean up temp file if it exists
        if os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except Exception:
                pass
        raise e



def wipe_personal_data():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        downloads_dir = os.path.join(base_dir, "static", "downloads")
        if os.path.exists(downloads_dir):
            import shutil
            for filename in os.listdir(downloads_dir):
                file_path = os.path.join(downloads_dir, filename)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path):
                        shutil.rmtree(file_path)
                except Exception:
                    pass
    except Exception:
        pass


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
    if 'Balance' not in master_df.columns:
        master_df['Balance'] = ""

    master_df['Name'] = master_df['Name'].fillna("")
    master_df['Type'] = master_df['Type'].fillna("")
    master_df['Status'] = master_df['Status'].fillna("")
    master_df['Transaction ID'] = master_df['Transaction ID'].fillna("")
    master_df['Balance'] = master_df['Balance'].fillna("")

    timestamp_source = (
        master_df['Date'].fillna("").astype(str).str.strip() + " " +
        master_df['Time'].fillna("").astype(str).str.strip()
    ).str.strip()

    master_df['_Timestamp'] = pd.to_datetime(timestamp_source, errors='coerce')
    master_df['_Amount_Num'] = master_df['Amount'].apply(parse_amount)
    master_df['_Abs_Amount'] = master_df['_Amount_Num'].abs()
    master_df['_Balance_Num'] = master_df['Balance'].apply(parse_amount)
    master_df['_Type_Key'] = master_df['Type'].astype(str).str.strip().str.casefold()
    master_df['_Status_Key'] = master_df['Status'].astype(str).str.strip().str.casefold()
    master_df['_Name_Key'] = master_df['Name'].apply(paypal_name_key)
    master_df['_Is_PayPal_Name'] = master_df['_Name_Key'].apply(paypal_is_paypal_actor)
    master_df['Status_Debug'] = 'KEEP'

    return master_df

def paypal_group_has_settled_partner(keep_rows, row_idx, row):
    same_name_mask = keep_rows['_Name_Key'].eq(row['_Name_Key'])
    same_amount_mask = keep_rows['_Abs_Amount'].eq(row['_Abs_Amount'])
    settled_mask = keep_rows['_Type_Key'].isin(PAYPAL_BALANCE_EFFECTING_SETTLED_TYPES)
    return ((keep_rows.index != row_idx) & same_name_mask & same_amount_mask & settled_mask).any()

def paypal_group_has_matching_partner(keep_rows, row_idx, row, type_keys=None, require_non_paypal=False):
    partner_mask = (keep_rows.index != row_idx) & keep_rows['_Abs_Amount'].eq(row['_Abs_Amount'])
    if type_keys is not None:
        partner_mask &= keep_rows['_Type_Key'].isin(type_keys)
    if require_non_paypal:
        partner_mask &= ~keep_rows['_Is_PayPal_Name']
    return partner_mask.any()

def paypal_group_has_funding_partner(keep_rows, row_idx, row):
    settled_spend_mask = (
        keep_rows['_Type_Key'].isin(PAYPAL_BALANCE_EFFECTING_SETTLED_TYPES) &
        keep_rows['_Amount_Num'].lt(0) &
        keep_rows['_Abs_Amount'].eq(row['_Abs_Amount'])
    )
    return ((keep_rows.index != row_idx) & settled_spend_mask).any()

def paypal_group_has_auth_noise(group_rows, row_idx, row):
    noise_types = PAYPAL_AUTH_TYPES | {"void of authorization", PAYPAL_HOLD_REVERSAL_TYPE}
    same_amount_mask = group_rows['_Abs_Amount'].eq(row['_Abs_Amount'])
    noise_mask = group_rows['_Type_Key'].isin(noise_types)
    return ((group_rows.index != row_idx) & same_amount_mask & noise_mask).any()

def paypal_group_has_external_funding_pair(keep_rows, row_idx, row):
    funding_mask = (
        keep_rows['_Type_Key'].isin(PAYPAL_FUNDING_TYPES) &
        keep_rows['_Amount_Num'].gt(0) &
        keep_rows['_Abs_Amount'].eq(row['_Abs_Amount'])
    )
    return ((keep_rows.index != row_idx) & funding_mask).any()

def paypal_group_has_duplicate_chain(group_rows, row_idx, row):
    matching_rows = group_rows[
        (group_rows.index != row_idx) &
        group_rows['_Abs_Amount'].eq(row['_Abs_Amount'])
    ]
    if len(matching_rows) < 2:
        return False

    negative_non_paypal_rows = matching_rows[
        matching_rows['_Amount_Num'].lt(0) &
        ~matching_rows['_Is_PayPal_Name']
    ]
    if negative_non_paypal_rows.empty:
        return False

    chain_types = (
        PAYPAL_SETTLED_MERCHANT_TYPES |
        PAYPAL_AUTH_TYPES |
        PAYPAL_FUNDING_TYPES |
        {"other", "void of authorization"}
    )
    return matching_rows['_Type_Key'].isin(chain_types).any()

def paypal_remove_matching_group_rows(master_df, group_rows, row, type_keys, reason, same_name=False):
    removal_mask = (
        master_df.index.isin(group_rows.index) &
        master_df['Status_Debug'].eq('KEEP') &
        master_df['_Type_Key'].isin(type_keys) &
        master_df['_Abs_Amount'].eq(row['_Abs_Amount'])
    )
    if same_name and row['_Name_Key']:
        removal_mask &= master_df['_Name_Key'].eq(row['_Name_Key'])
    master_df.loc[removal_mask, 'Status_Debug'] = reason

def paypal_remove_external_payment_chain(master_df, group_rows, idx, row, payment_reason, funding_reason, auth_reason):
    master_df.at[idx, 'Status_Debug'] = payment_reason
    paypal_remove_matching_group_rows(
        master_df,
        group_rows,
        row,
        PAYPAL_FUNDING_TYPES,
        funding_reason
    )
    paypal_remove_matching_group_rows(
        master_df,
        group_rows,
        row,
        PAYPAL_AUTH_TYPES,
        auth_reason,
        same_name=True
    )
    paypal_remove_matching_group_rows(
        master_df,
        group_rows,
        row,
        {PAYPAL_HOLD_REVERSAL_TYPE},
        'REMOVED: PayPal Duplicate Chain Hold Reversal'
    )

def paypal_rows_match_external_funding(payment_row, funding_row):
    if pd.isna(payment_row['_Balance_Num']) or pd.isna(funding_row['_Balance_Num']):
        return False
    expected_payment_balance = funding_row['_Balance_Num'] + payment_row['_Amount_Num']
    return abs(expected_payment_balance - payment_row['_Balance_Num']) < 0.01

def paypal_mobile_payment_looks_external(row):
    if row['_Amount_Num'] >= 0:
        return False
    if pd.isna(row['_Balance_Num']):
        return False
    return row['_Balance_Num'] <= 0 and abs(row['_Balance_Num'] - row['_Amount_Num']) < 0.01

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
        active_rows = master_df.loc[group_rows.index]
        active_rows = active_rows[active_rows['Status_Debug'].eq('KEEP')]
        if active_rows.empty:
            continue

        hold_reversal_rows = active_rows[
            active_rows['_Type_Key'].eq(PAYPAL_HOLD_REVERSAL_TYPE)
        ]
        for idx, row in hold_reversal_rows.iterrows():
            if paypal_group_has_duplicate_chain(active_rows, idx, row):
                master_df.at[idx, 'Status_Debug'] = 'REMOVED: PayPal Duplicate Chain Hold Reversal'

        paypal_other_rows = active_rows[
            active_rows['_Type_Key'].eq('other') & active_rows['_Is_PayPal_Name']
        ]
        for idx, row in paypal_other_rows.iterrows():
            if paypal_group_has_auth_noise(active_rows, idx, row):
                master_df.at[idx, 'Status_Debug'] = 'REMOVED: PayPal Authorization Noise'

        active_rows = master_df.loc[group_rows.index]
        active_rows = active_rows[active_rows['Status_Debug'].eq('KEEP')]

        always_external_rows = active_rows[
            active_rows['_Type_Key'].isin(PAYPAL_ALWAYS_EXTERNAL_PAYMENT_TYPES) &
            active_rows['_Amount_Num'].lt(0)
        ]
        for idx, row in always_external_rows.iterrows():
            paypal_remove_external_payment_chain(
                master_df,
                group_rows,
                idx,
                row,
                'REMOVED: Always External Express Checkout Payment',
                'REMOVED: Funding Leg for Express Checkout Payment',
                'REMOVED: Merchant Authorization Paired to Express Checkout Payment'
            )

        active_rows = master_df.loc[group_rows.index]
        active_rows = active_rows[active_rows['Status_Debug'].eq('KEEP')]
        external_payment_rows = active_rows[
            active_rows['_Type_Key'].isin(PAYPAL_EXTERNALLY_FUNDED_PAYMENT_TYPES) &
            active_rows['_Amount_Num'].lt(0)
        ]
        for idx, row in external_payment_rows.iterrows():
            funding_candidates = active_rows[
                active_rows['_Type_Key'].isin(PAYPAL_FUNDING_TYPES) &
                active_rows['_Amount_Num'].gt(0) &
                active_rows['_Abs_Amount'].eq(row['_Abs_Amount'])
            ]
            matched_funding = None
            for funding_idx, funding_row in funding_candidates.iterrows():
                if paypal_rows_match_external_funding(row, funding_row):
                    matched_funding = (funding_idx, funding_row)
                    break

            if matched_funding is not None:
                paypal_remove_external_payment_chain(
                    master_df,
                    group_rows,
                    idx,
                    row,
                    'REMOVED: External Funding Payment Duplicate',
                    'REMOVED: Funding Leg for External Payment',
                    'REMOVED: Merchant Authorization Paired to External Funding'
                )

        active_rows = master_df.loc[group_rows.index]
        active_rows = active_rows[active_rows['Status_Debug'].eq('KEEP')]
        mobile_payment_rows = active_rows[
            active_rows['_Type_Key'].eq('mobile payment') &
            active_rows['_Amount_Num'].lt(0)
        ]
        for idx, row in mobile_payment_rows.iterrows():
            if paypal_mobile_payment_looks_external(row):
                master_df.at[idx, 'Status_Debug'] = 'REMOVED: Externally Funded Mobile Payment'

        active_rows = master_df.loc[group_rows.index]
        active_rows = active_rows[active_rows['Status_Debug'].eq('KEEP')]
        funding_rows = active_rows[active_rows['_Type_Key'].isin(PAYPAL_FUNDING_TYPES)]
        for idx, row in funding_rows.iterrows():
            if paypal_group_has_funding_partner(active_rows, idx, row):
                master_df.at[idx, 'Status_Debug'] = 'REMOVED: Funding Leg for Settled Charge'

        active_rows = master_df.loc[group_rows.index]
        active_rows = active_rows[active_rows['Status_Debug'].eq('KEEP')]
        auth_rows = active_rows[active_rows['_Type_Key'].isin(PAYPAL_AUTH_TYPES)]
        for idx, row in auth_rows.iterrows():
            if paypal_group_has_settled_partner(active_rows, idx, row):
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
    
    potential_pairs = []
    
    for i in range(len(transactions)):
        t1 = transactions[i]
        
        # Date logic
        exact_d1 = None
        try:
            exact_d1 = datetime.fromisoformat(t1['date'].replace('Z', '+00:00'))
        except Exception:
            pass

        for j in range(i + 1, len(transactions)):
            t2 = transactions[j]
            
            # Check for opposites
            if (t1['amount'] > 0 and t2['amount'] > 0) or (t1['amount'] < 0 and t2['amount'] < 0): continue
            if abs(t1['amount']) != abs(t2['amount']): continue
            
            exact_d2 = None
            try:
                exact_d2 = datetime.fromisoformat(t2['date'].replace('Z', '+00:00'))
            except Exception:
                pass
            
            days_delta = 999.0
            if exact_d1 and exact_d2:
                days_delta = abs((exact_d1 - exact_d2).total_seconds()) / 86400.0
                
            rule_matched = False
            for rule in rules:
                if not rule.get('acc1') or not rule.get('acc2'): continue
                matchA = (rule['acc1'].lower() in t1['account'].lower() and rule['desc1'].lower() in t1['desc'].lower() and
                          rule['acc2'].lower() in t2['account'].lower() and rule['desc2'].lower() in t2['desc'].lower())
                matchB = (rule['acc2'].lower() in t1['account'].lower() and rule['desc2'].lower() in t1['desc'].lower() and
                          rule['acc1'].lower() in t2['account'].lower() and rule['desc1'].lower() in t2['desc'].lower())
                if matchA or matchB:
                    rule_matched = True
                    break
                    
            if rule_matched or (days_delta <= 3.0 and t1['account'] != t2['account']):
                potential_pairs.append((days_delta, not rule_matched, i, j))

    # Process pairs greedily
    # Sort primarily by: explicit explicit rule matches first (False), then by time proximity
    potential_pairs.sort(key=lambda x: (x[1], x[0]))

    for delta, rule_fallback, i, j in potential_pairs:
        t1 = transactions[i]
        t2 = transactions[j]
        
        # Ensure neither has been stolen by a better match already
        if t1['isTransfer'] or t2['isTransfer']:
            continue
            
        t1['isTransfer'] = True
        t2['isTransfer'] = True
        t1['transferPartnerTxId'] = t2['id']
        t2['transferPartnerTxId'] = t1['id']
        
        if t1['amount'] > 0: t1['isHidden'] = True
        if t2['amount'] > 0: t2['isHidden'] = True
        
        t1['category'] = "Transfers"
        t2['category'] = "Transfers"
        
    for i in range(len(transactions)):
        t1 = transactions[i]
        if t1['isTransfer']: continue

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


def parse_dummy_csvs(dummy_dir):
    transactions = []
    
    checking_path = os.path.join(dummy_dir, "Dummy_Checking.csv")
    savings_path = os.path.join(dummy_dir, "Dummy_Savings.csv")
    cc_path = os.path.join(dummy_dir, "Dummy_CreditCard.csv")
    paypal_path = os.path.join(dummy_dir, "Dummy_PayPal.csv")
    
    app_data = load_data()
    custom_categories = app_data.get('customCategories', {})
    rules = app_data.get('transferRules', [])
    
    def parse_bank_file(path, account_default):
        rows = []
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if not header:
                return
            for row in reader:
                if not row or len(row) < 7:
                    continue
                acc, date_str, desc, amt_str, debit_str, credit_str, notes = row
                
                try:
                    dt = datetime.strptime(date_str, "%m/%d/%Y")
                except Exception:
                    continue
                    
                amt = 0.0
                try:
                    amt = float(amt_str)
                except ValueError:
                    c_val = parse_amount(credit_str)
                    d_val = parse_amount(debit_str)
                    amt = c_val - d_val
                    
                norm_desc = normalize_desc(desc)
                tx_id = f"{int(dt.timestamp() * 1000)}_{amt}_{re.sub(r'[^a-zA-Z0-9]', '', desc)}"
                cat = guess_category(desc, amt, custom_categories)
                
                rows.append({
                    "id": tx_id,
                    "date": dt.isoformat(),
                    "desc": desc,
                    "normalizedDesc": norm_desc,
                    "amount": amt,
                    "notes": notes,
                    "category": cat,
                    "originalCategory": guess_category(desc, amt, custom_categories),
                    "account": acc if acc else account_default,
                    "isTransfer": False,
                    "isHidden": False,
                    "isolate": False,
                    "transferPartnerTxId": None
                })
        transactions.extend(rows)
        
    def parse_cc_file(path):
        rows = []
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if not header:
                return
            for row in reader:
                if not row or len(row) < 3:
                    continue
                date_str, desc, amt_str = row[0], row[1], row[2]
                memo = row[3] if len(row) > 3 else ""
                
                try:
                    dt = datetime.strptime(date_str, "%m/%d/%Y")
                except Exception:
                    continue
                    
                amt = parse_amount(amt_str)
                norm_desc = normalize_desc(desc)
                tx_id = f"{int(dt.timestamp() * 1000)}_{amt}_{re.sub(r'[^a-zA-Z0-9]', '', desc)}"
                cat = guess_category(desc, amt, custom_categories)
                
                rows.append({
                    "id": tx_id,
                    "date": dt.isoformat(),
                    "desc": desc,
                    "normalizedDesc": norm_desc,
                    "amount": amt,
                    "notes": memo,
                    "category": cat,
                    "originalCategory": guess_category(desc, amt, custom_categories),
                    "account": "Dummy CreditCard",
                    "isTransfer": False,
                    "isHidden": False,
                    "isolate": False,
                    "transferPartnerTxId": None
                })
        transactions.extend(rows)

    def parse_paypal_file(path):
        if not os.path.exists(path):
            return
        df = pd.read_csv(path, index_col=None, header=0, low_memory=False)
        clean_export, debug_export = build_paypal_exports(df)
        
        base_dir = os.path.dirname(os.path.abspath(__file__))
        debug_path = os.path.join(base_dir, "static", "downloads", "PayPal_DEBUG_LOG.csv")
        master_path = os.path.join(base_dir, "static", "downloads", "PayPal_Master_History.csv")
        os.makedirs(os.path.dirname(debug_path), exist_ok=True)
        debug_export.to_csv(debug_path, index=False)
        clean_export.to_csv(master_path, index=False)
        
        rows = []
        for index, r in clean_export.iterrows():
            date_str = str(r.get('Date', ''))
            time_str = str(r.get('Time', ''))
            name = str(r.get('Name', ''))
            typ = str(r.get('Type', ''))
            gross_str = str(r.get('Gross', '0'))
            
            try:
                dt_str = f"{date_str} {time_str}".strip()
                dt = datetime.strptime(dt_str, "%m/%d/%Y %H:%M:%S")
            except Exception:
                try:
                    dt = datetime.strptime(date_str, "%m/%d/%Y")
                except Exception:
                    continue
            
            amt = parse_amount(gross_str)
            desc = name if name else typ
            norm_desc = normalize_desc(desc)
            tx_id = f"{int(dt.timestamp() * 1000)}_{amt}_{re.sub(r'[^a-zA-Z0-9]', '', desc)}"
            cat = guess_category(desc, amt, custom_categories)
            
            rows.append({
                "id": tx_id,
                "date": dt.isoformat(),
                "desc": desc,
                "normalizedDesc": norm_desc,
                "amount": amt,
                "notes": typ,
                "category": cat,
                "originalCategory": guess_category(desc, amt, custom_categories),
                "account": "Dummy PayPal",
                "isTransfer": False,
                "isHidden": False,
                "isolate": False,
                "transferPartnerTxId": None
            })
        transactions.extend(rows)
        
    parse_bank_file(checking_path, "Dummy Checking")
    parse_bank_file(savings_path, "Dummy Savings")
    parse_cc_file(cc_path)
    parse_paypal_file(paypal_path)
    
    # Sort backwards by date
    transactions.sort(key=lambda x: x['date'], reverse=True)
    
    # Apply transfer rules
    apply_transfer_rules(transactions, rules)
    
    return transactions


@app.route('/api/init-data', methods=['GET'])
def init_data():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        payload_path = os.path.join(base_dir, 'static', 'downloads', 'debug_frontend_payload.json')
        
        # If debug_frontend_payload.json exists, return it!
        if os.path.exists(payload_path):
            with open(payload_path, 'r', encoding='utf-8') as f:
                transactions = json.load(f)
            return jsonify({"transactions": transactions})
            
        return jsonify({"transactions": []})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/load-demo-data', methods=['POST'])
def load_demo_data():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        payload_path = os.path.join(base_dir, 'static', 'downloads', 'debug_frontend_payload.json')
        
        dummy_dir = os.path.abspath(os.path.join(base_dir, "..", "..", "shared", "Demo CSVs"))
        if os.path.exists(dummy_dir):
            mock_transactions = parse_dummy_csvs(dummy_dir)
            
            os.makedirs(os.path.dirname(payload_path), exist_ok=True)
            with open(payload_path, 'w', encoding='utf-8') as f:
                json.dump(mock_transactions, f, indent=2)
                
            return jsonify({"transactions": mock_transactions})
            
        return jsonify({"error": f"Demo CSVs directory not found at {dummy_dir}"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/download-file', methods=['POST'])
def download_file():
    import shutil
    data = request.json
    file_type = data.get('type') # 'cleaned', 'debug', 'mega_csv', 'settings'
    filename = data.get('filename')
    content = data.get('content')
    
    # Resolve Downloads directory
    downloads_dir = os.path.join(os.path.expanduser("~"), "Downloads")
    if not os.path.exists(downloads_dir):
        downloads_dir = os.path.join(os.path.expanduser("~"), "Desktop")
        
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    try:
        if content is not None:
            if not filename:
                return jsonify({"error": "Filename is required for custom content download"}), 400
            dest_path = os.path.join(downloads_dir, filename)
            with open(dest_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return jsonify({"status": "success", "path": dest_path})
            
        if file_type == 'cleaned':
            src_path = os.path.join(base_dir, "static", "downloads", "PayPal_Master_History.csv")
            dest_filename = "PayPal_Master_History_Cleaned.csv"
        elif file_type == 'debug':
            src_path = os.path.join(base_dir, "static", "downloads", "PayPal_DEBUG_LOG.csv")
            dest_filename = "PayPal_DEBUG_LOG.csv"
        elif file_type == 'mega_csv':
            src_path = None
            dest_filename = "Mega_Combined_Ledger.csv"
        elif file_type == 'settings':
            src_path = None
            dest_filename = "megaboard_settings_backup.json"
        else:
            return jsonify({"error": "Unknown file type"}), 400
            
        dest_path = os.path.join(downloads_dir, dest_filename)
        
        if file_type == 'mega_csv':
            payload_path = os.path.join(base_dir, 'static', 'downloads', 'debug_frontend_payload.json')
            if not os.path.exists(payload_path):
                return jsonify({"error": "No transaction data loaded to export."}), 400
            with open(payload_path, 'r', encoding='utf-8') as f:
                transactions = json.load(f)
            
            sorted_txs = sorted(transactions, key=lambda x: x['date'])
            
            rows = []
            rows.append(["Date", "Description", "Amount", "Account", "Category", "Notes", "Is Transfer", "Is Ghost"])
            addedGhostTxIds = set()
            
            for tx in sorted_txs:
                try:
                    dt = datetime.fromisoformat(tx['date'])
                    date_str = dt.strftime("%m/%d/%Y")
                except Exception:
                    date_str = str(tx['date']).split('T')[0]
                    
                rows.append([
                    date_str,
                    tx['desc'],
                    f"{tx['amount']:.2f}",
                    tx['account'],
                    tx['category'],
                    tx.get('notes', ''),
                    "TRUE" if tx.get('isTransfer') else "FALSE",
                    "FALSE"
                ])
                
                if tx.get('isTransfer') and tx.get('transferPartnerAccount') and not tx.get('transferPartnerTxId') and tx['id'] not in addedGhostTxIds:
                    ghost_amt = -tx['amount']
                    rows.append([
                        date_str,
                        f"Transfer with {tx['account']}",
                        f"{ghost_amt:.2f}",
                        tx['transferPartnerAccount'],
                        "Transfers",
                        tx.get('notes', ''),
                        "TRUE",
                        "TRUE"
                    ])
                    addedGhostTxIds.add(tx['id'])
                    
                if tx.get('isolate') and tx.get('category') == 'Transfers' and tx.get('manualTransferAccount') and tx['id'] not in addedGhostTxIds:
                    ghost_amt = -tx['amount']
                    rows.append([
                        date_str,
                        f"Transfer with {tx['account']}",
                        f"{ghost_amt:.2f}",
                        tx['manualTransferAccount'],
                        "Transfers",
                        tx.get('notes', ''),
                        "TRUE",
                        "TRUE"
                    ])
                    addedGhostTxIds.add(tx['id'])
            
            with open(dest_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerows(rows)
                
        elif file_type == 'settings':
            settings_data = load_data()
            with open(dest_path, 'w', encoding='utf-8') as f:
                json.dump(settings_data, f, indent=4)
                
        else:
            if not os.path.exists(src_path):
                return jsonify({"error": f"Source file does not exist: {os.path.basename(src_path)}"}), 404
            shutil.copy2(src_path, dest_path)
            
        return jsonify({"status": "success", "path": dest_path})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
            
        # 3. Wipe personal data
        wipe_personal_data()
            
        # 4. Natively crash this process securely so the pywebview window dies instantly and hands execution back to the `.app` shell wrapper
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
            
            if not d_indices:
                return jsonify({"error": f"Uploaded CSV for '{account_name}' lacks a Date column mapping. Please map a Date column."}), 400
            if not a_indices and (dr_idx == -1 or cr_idx == -1):
                return jsonify({"error": f"Uploaded CSV for '{account_name}' lacks an Amount or Debit/Credit column mapping. Please map these columns."}), 400
            
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

    try:
        import json
        with open(os.path.join('static', 'downloads', 'debug_frontend_payload.json'), 'w') as f:
            json.dump(parsed_transactions, f, indent=2)
    except Exception:
        pass

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
    
    wipe_personal_data()

    return jsonify({"status": "success"})


@app.route('/api/quit', methods=['POST'])
def quit_app():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        shared_dir = os.path.abspath(os.path.join(base_dir, "..", "..", "shared"))
        
        # Remove restart flag so AppleScript runner exits
        restart_path = os.path.join(shared_dir, "restart_flag")
        if os.path.exists(restart_path):
            try:
                os.remove(restart_path)
            except Exception:
                pass
                
        # Wipe all personal data
        wipe_personal_data()
            
        # Kill the process after a short delay
        import threading
        def hard_kill():
            import time
            time.sleep(0.5)
            import os
            os._exit(0)
            
        threading.Thread(target=hard_kill).start()
        return jsonify({"status": "quitting"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/restart', methods=['POST'])
def restart_app():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        shared_dir = os.path.abspath(os.path.join(base_dir, "..", "..", "shared"))
        
        # Write the restart flag
        restart_path = os.path.join(shared_dir, "restart_flag")
        with open(restart_path, "w") as f:
            f.write("true")
            
        # Wipe all personal data
        wipe_personal_data()
            
        # Kill the process after a short delay
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


if __name__ == '__main__':
    app.run(debug=True, port=5050)
