import pandas as pd
import glob
import os

def create_debug_history(input_folder, output_file):
    # 1. Gather all files
    all_files = glob.glob(os.path.join(input_folder, "*.csv")) + \
                glob.glob(os.path.join(input_folder, "*.CSV"))
    
    if not all_files:
        print("❌ No CSV files found in 'paypal_files' folder!")
        return

    print(f"Reading {len(all_files)} files...")
    li = []
    for filename in all_files:
        df = pd.read_csv(filename, index_col=None, header=0, low_memory=False)
        # Track which file each row came from
        df['Source_File'] = os.path.basename(filename)
        li.append(df)

    # Stitch everything together
    master_df = pd.concat(li, axis=0, ignore_index=True)
    
    # Standardize column names
    name_cols = ['Name', 'Recipient', 'Recipient Name']
    amt_cols = ['Amount', 'Net', 'Gross']
    for col in name_cols:
        if col in master_df.columns: master_df.rename(columns={col: 'Name'}, inplace=True)
    for col in amt_cols:
        if col in master_df.columns: master_df.rename(columns={col: 'Amount'}, inplace=True)

    # --- THE DEBUG LOGIC ---
    # We start by assuming we keep everything
    master_df['Status_Debug'] = 'KEEP'
    
    # 1. Flag Non-Completed (Denied/Expired)
    master_df.loc[~master_df['Status'].str.contains('Completed', case=False, na=False), 'Status_Debug'] = 'REMOVED: Not Completed'

    # 2. Flag Funding Pairs (The "Bank Transfer Dance")
    master_df['Timestamp'] = pd.to_datetime(master_df['Date'] + ' ' + master_df['Time'])
    master_df['Abs_Amount'] = master_df['Amount'].astype(float).abs()
    
    # Look at rows that are still marked 'KEEP' to find pairs
    potential_pairs = master_df[master_df['Status_Debug'] == 'KEEP']
    groups = potential_pairs.groupby(['Timestamp', 'Abs_Amount'])
    
    for _, group in groups:
        if len(group) > 1:
            # Logic to pick the winner (Negative amount with a Name)
            with_name = group[group['Name'].notna()]
            target_idx = None
            
            if not with_name.empty:
                negatives = with_name[with_name['Amount'].astype(float) < 0]
                if not negatives.empty:
                    target_idx = negatives.index[0]
                else:
                    target_idx = with_name.index[0]
            else:
                target_idx = group.index[0]
            
            # Flag all the "losers" in the pair
            other_indices = [idx for idx in group.index if idx != target_idx]
            master_df.loc[other_indices, 'Status_Debug'] = 'REMOVED: Duplicate/Funding Pair'

    # 3. Flag "Filler" Authorizations (Empty rows with no names)
    filler_mask = (master_df['Status_Debug'] == 'KEEP') & \
                  (master_df['Type'].str.contains('Authorization', case=False, na=False)) & \
                  (master_df['Name'].isna())
    master_df.loc[filler_mask, 'Status_Debug'] = 'REMOVED: Empty Auth'

    # 4. Flag Cross-File Duplicates
    # If the same Transaction ID appears in two different yearly CSVs
    dup_id_mask = master_df.duplicated(subset=['Transaction ID'], keep='first')
    master_df.loc[(master_df['Status_Debug'] == 'KEEP') & dup_id_mask, 'Status_Debug'] = 'REMOVED: Duplicate ID'

    # Final Sorting
    master_df = master_df.sort_values(by='Timestamp', ascending=False)
    
    # Drop the helper columns we used for calculation
    master_df = master_df.drop(columns=['Timestamp', 'Abs_Amount'])
    
    master_df.to_csv(output_file, index=False)
    print(f"\n✨ DEBUG LOG CREATED: {output_file}")
    print(master_df['Status_Debug'].value_counts())

if __name__ == "__main__":
    create_debug_history("paypal_files", "PayPal_DEBUG_LOG.csv")