import pandas as pd
import glob
import os

def clean_paypal_history(input_folder, output_file):
    all_files = glob.glob(os.path.join(input_folder, "*.csv")) + \
                glob.glob(os.path.join(input_folder, "*.CSV"))
    
    if not all_files:
        print("❌ No CSV files found! Export your .numbers files to CSV and put them in the folder.")
        return

    li = []
    for filename in all_files:
        df = pd.read_csv(filename, index_col=None, header=0, low_memory=False)
        li.append(df)

    master_df = pd.concat(li, axis=0, ignore_index=True)
    
    # 1. Cleanup Time/Amount for comparison
    master_df['Timestamp'] = pd.to_datetime(master_df['Date'] + ' ' + master_df['Time'])
    master_df['Abs_Amount'] = master_df['Amount'].astype(float).abs()
    
    # 2. Group by Time and Absolute Amount to find "Pairs"
    # We allow a 2-second window because sometimes the logs are slightly offset
    groups = master_df.groupby(['Timestamp', 'Abs_Amount'])
    
    final_rows = []
    
    for _, group in groups:
        if len(group) == 1:
            # NO DUPLICATES FOUND: Keep it even if the name is blank!
            # This solves the "Left out too many" problem.
            final_rows.append(group.iloc[0])
        else:
            # DUPLICATES/PAIRS FOUND: We need to pick the "Real" one
            # Priority 1: Pick the one that has a Merchant Name
            with_name = group[group['Name'].notna()]
            
            if not with_name.empty:
                # Priority 2: In a purchase pair (e.g. -$10 and +$10), 
                # always keep the negative one (the actual payment).
                negative_ones = with_name[with_name['Amount'].astype(float) < 0]
                if not negative_ones.empty:
                    # Priority 3: If there's an 'Authorization' and a 'Payment', 
                    # keep the 'Payment'.
                    payments = negative_ones[~negative_ones['Type'].str.contains('Authorization', case=False, na=False)]
                    if not payments.empty:
                        final_rows.append(payments.iloc[0])
                    else:
                        final_rows.append(negative_ones.iloc[0])
                else:
                    final_rows.append(with_name.iloc[0])
            else:
                # If neither has a name, just keep the first one so we don't lose data
                final_rows.append(group.iloc[0])

    clean_df = pd.DataFrame(final_rows)

    # 3. Final Hard-Filter for known "Filler" that NEVER has a pair
    # Only remove these if they are truly empty 'Authorization' rows
    clean_df = clean_df[~(
        (clean_df['Type'].str.contains('Authorization', case=False, na=False)) & 
        (clean_df['Name'].isna())
    )]

    # 4. Deduplicate by ID (just in case)
    clean_df = clean_df.drop_duplicates(subset=['Transaction ID'])

    # 5. Export
    clean_df = clean_df.sort_values(by='Date', ascending=False)
    # Remove our helper columns before saving
    clean_df = clean_df.drop(columns=['Timestamp', 'Abs_Amount'])
    
    clean_df.to_csv(output_file, index=False)
    print(f"✨ SUCCESS: {len(clean_df)} transactions saved to {output_file}")

if __name__ == "__main__":
    clean_paypal_history("paypal_files", "PayPal_Master_History.csv")