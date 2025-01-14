import pandas as pd

# File paths
file_path = './mapped.csv'
output_path = './products_fixed.csv'

# Load the CSV file
products_csv = pd.read_csv(file_path)

# Strip whitespace from column names
products_csv.columns = products_csv.columns.str.strip()

# Define maximum tabs and bars
MAX_PRODUCT_OPTION_TABS = 3
MAX_PRODUCT_OPTION_BARS = 3

# Generate dynamic column names
def generate_dynamic_columns(max_tabs, max_bars):
    """Generate column names dynamically for tabs and bars."""
    numeric_columns = []
    string_columns = []
    for i in range(1, max_tabs + 1):  # Iterate over tabs
        # Add label and visibility for each tab
#         string_columns.append(f"variant:optionTab{i}Label")
#         string_columns.append(f"variant:optionTab{i}Visible")

        for j in range(1, max_bars + 1):  # Iterate over bars
            # Add all relevant fields for each bar in the tab
            string_columns.extend([
#                 f"variant:optionTab{i}Bar{j}Name",
#                 f"variant:optionTab{i}Bar{j}MinLabel",
#                 f"variant:optionTab{i}Bar{j}MaxLabel",
            ])
            numeric_columns.extend([
#                 f"variant:optionTab{i}Bar{j}Min",
#                 f"variant:optionTab{i}Bar{j}Max",
#                 f"variant:optionTab{i}Bar{j}Rating"
            ])
    return numeric_columns, string_columns

# Generate dynamic columns
numeric_columns, string_columns = generate_dynamic_columns(MAX_PRODUCT_OPTION_TABS, MAX_PRODUCT_OPTION_BARS)

# Fixed columns that require quoting
fixed_columns_to_quote = [
   # "description",
#     "optionGroups",
#     "optionValues",
    #"product:brand",
#    "variant:descriptionTab1Label",
#    "variant:descriptionTab1Content",
]

# Combine fixed and dynamic columns
columns_to_quote = fixed_columns_to_quote + string_columns

# Remove rows with all empty values
products_csv = products_csv.dropna(how='all')

# Escape strings for CSV import
def escape_string(value):
    """Escapes embedded double quotes and ensures single wrapping of quotes."""
    if pd.notna(value):
        # Convert to string, strip existing quotes, and escape internal quotes
        escaped_value = str(value).strip('"').replace('"', '""')
        # Wrap in a single pair of quotes
        return f'"{escaped_value}"'
    return value

# Apply escaping and quoting to the selected string columns
for column in columns_to_quote:
    if column in products_csv.columns:
        products_csv[column] = products_csv[column].apply(escape_string)

# Convert float columns to double precision
for column in numeric_columns:
    if column in products_csv.columns:
        products_csv[column] = products_csv[column].apply(
            lambda x: float(str(x).replace(',', '.').replace('"', ''))
            if pd.notna(x) and str(x).replace(',', '.').replace('"', '').replace('.', '').isdigit()
            else x
        )
        products_csv[column] = products_csv[column].astype('float64')

# Save the updated CSV file
products_csv.to_csv(output_path, index=False)

print(f"File saved to {output_path}")

