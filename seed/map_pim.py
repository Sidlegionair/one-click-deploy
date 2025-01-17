import pandas as pd
import re
import argparse
import sys

def clean_html(raw_html):
    if pd.isna(raw_html):
        return ''
    allowed_tags = [
        '<b>', '</b>', '<i>', '</i>', '<strong>', '</strong>',
        '<em>', '</em>', '<br>', '<ul>', '</ul>', '<li>', '</li>',
        '<p>', '</p>', '<a>', '</a>', '<span>', '</span>',
        '<h1>', '</h1>', '<h2>', '</h2>', '<h3>', '</h3>',
        '<div>', '</div>', '<img>', '<hr>'
    ]
    cleanr = re.compile(r'<(?!/?(?:' + '|'.join(tag[1:-1] for tag in allowed_tags) + r')\b)[^>]*>')
    return re.sub(cleanr, '', str(raw_html))

def parse_rating(value):
    """
    Parses a rating value into a float, handling percentages, fractional ratings (0.x), and edge cases.

    Args:
        value (Any): The input value to parse.

    Returns:
        float: Parsed rating value, scaled as needed, or NaN if parsing fails.
    """
    try:
        # Handle None or empty values
        if not value or pd.isna(value):
            return float('nan')

        # Handle numeric types (int, float)
        if isinstance(value, (int, float)):
            return value * 100 if 0 < value <= 1 else value

        # Handle strings
        if isinstance(value, str):
            # Normalize string (remove unwanted characters, strip whitespace)
            value = value.replace('%', '').strip()

            # Try converting directly to float
            numeric_value = float(value)

            # Scale fractional ratings (e.g., 0.7 -> 70)
            return numeric_value * 100 if 0 < numeric_value <= 1 else numeric_value

        # If value type is unexpected, return NaN
        return float('nan')

    except (ValueError, TypeError):
        # Log the error for debugging (can be commented out in production)
        print(f"Unable to parse rating value: {value}")
        return float('nan')

def should_tab_be_visible(tab_bars):
    return any(bar['visible'] for bar in tab_bars)

def parse_and_process_bars(row, bar_info, tab_id=None):
    bars = []
    for i, (bar_name, source_key) in enumerate(bar_info, start=1):
        # Fetch the raw value
        raw_value = row.get(source_key, 'Missing Key')
        print(f"Processing {bar_name}: Source Key='{source_key}', Raw Value='{raw_value}'")

        # Parse the rating
        rating = parse_rating(raw_value)
        print(f"Parsed Rating for {bar_name}: {rating}")

        visible = not pd.isna(rating) and rating > 0

        # Default labels
        min_label = ''
        max_label = ''

        # Set tab-specific labels
        if tab_id == 1:  # Tab 1 (Description Tab)
            if i == 1:  # Bar 1
                min_label = 'Beginner'
                max_label = 'Expert'
            elif i == 2:  # Bar 2 (Flex)
                min_label = 'Soft'
                max_label = 'Stiff'

        bars.append({
            'name': bar_name,
            'visible': visible,
            'rating': rating if visible else '',
            'minLabel': min_label if visible else '',
            'maxLabel': max_label if visible else '',
            'min': '10',    # Preserved from original script
            'max': '100',   # Preserved from original script
        })
    return bars, should_tab_be_visible(bars)

def combine_option_groups_and_values(row, option_group_columns, option_value_columns):
    """
    Combine OptionGroups and OptionValues into separate pipe-separated strings.
    Returns:
        tuple: (optionGroups_str, optionValues_str)
    """
    option_groups = []
    option_values = []
    for group_col, value_col in zip(option_group_columns, option_value_columns):
        group = row.get(group_col, '')
        value = row.get(value_col, '')
        if not pd.isna(group) and str(group).strip() != '':
            option_groups.append(str(group).strip())
        if not pd.isna(value) and str(value).strip() != '':
            option_values.append(str(value).strip())

    # Combine with pipes
    optionGroups_str = '|'.join(option_groups)
    optionValues_str = '|'.join(option_values)

    # Strip spaces around pipes
    optionGroups_str = re.sub(r'\s*\|\s*', '|', optionGroups_str)
    optionValues_str = re.sub(r'\s*\|\s*', '|', optionValues_str)

    # Debugging: Print combined option groups and values
    print(f"Combined Option Groups: {optionGroups_str}")
    print(f"Combined Option Values: {optionValues_str}")

    return optionGroups_str, optionValues_str

def process_facets(row):
    """
    Extract facets from the 'Facets' field and strip spaces around pipes.
    E.g., "Facet1:Value1 | Facet2:Value2" -> "Facet1:Value1|Facet2:Value2"
    """
    facets = row.get('Facets', '')
    if pd.isna(facets):
        return ''
    # Replace spaces around pipes
    facets_clean = re.sub(r'\s*\|\s*', '|', str(facets).strip())
    return facets_clean

import pandas as pd

import re
import pandas as pd

from decimal import Decimal, InvalidOperation

def clean_and_convert(row, key, data_type):
    """
    Retrieves the value from the row, handles NaN, and converts it to the specified data type.

    Parameters:
    - row: The pandas Series object representing the row.
    - key: The column name.
    - data_type: The expected data type ('int', 'float', 'bool', 'string', 'text', 'relation').

    Returns:
    - The cleaned and converted value.
    """
    value = row.get(key, None)
    if pd.isna(value):
        return ''

    try:
        if data_type == 'int':
            # Remove non-numeric characters except negative signs and digits
            value = re.sub(r'[^\d-]', '', str(value))
            return int(value)
        elif data_type == 'float':
            if isinstance(value, str):
                # Remove non-numeric characters except dots and minus signs
                value = re.sub(r'[^\d.-]', '', value)
            # Use Decimal for precise handling
            value = Decimal(value)
            return float(value.quantize(Decimal('0.00001')))  # Limit to 5 decimal places
        elif data_type == 'bool':
            if isinstance(value, bool):
                return value
            if isinstance(value, (int, float)):
                return bool(value)
            if isinstance(value, str):
                return value.strip().lower() in ['true', '1', 'yes']
            return False
        elif data_type in ['string', 'text']:
            return str(value).strip()
        elif data_type == 'relation':
            # Ensure it's a valid UUID or identifier; assuming string representation
            return str(value).strip()
        else:
            return str(value).strip()
    except (ValueError, TypeError, InvalidOperation):
        # Log the error and return empty string
        print(f"Error converting field '{key}' with value '{value}' to type '{data_type}'")
        return ''


def convert_source_to_products(source_file, output_file):
    try:
        source_data = pd.read_excel(source_file)
        print("Source data loaded successfully.")
    except Exception as e:
        print(f"Error loading source file: {e}")
        return

    # Strip only leading/trailing whitespace without removing internal spaces
    source_data.columns = source_data.columns.str.strip()

    # Define the necessary columns based on Vendure config with appropriate prefixes
    columns = [
        'name',                      # No prefix
        'slug',                      # No prefix
        'description',               # No prefix
#         'description:en',               # No prefix
#         'description:nl',
        'assets',                    # No prefix
        'facets',                    # No prefix
        'optionGroups',              # No prefix
        'optionValues',              # No prefix
        'sku',
        'price',
        'taxCategory',
        'stockOnHand',
        'trackInventory',
        'variantAssets',
        'variantFacets',
        'product:brand',             # Prefixed
        'product:warranty',
        'product:eanCode',
        'product:quote',
        'product:quoteOwner',
        'product:boardCategory',
        'product:terrain',
        'product:camberProfile',
        'product:profile',
        'product:baseProfile',
        'product:rider',
        'product:taperProfile',
        'product:bindingSize',
        'product:bindingMount',
        'product:edges',
        'product:sidewall',
        'product:core',
        'product:layup1',
        'product:layup2',
        'product:layup3',
        'product:boardbase',
        'variant:descriptionTab1Label',
        'variant:descriptionTab1Visible',
        'variant:descriptionTab1Content',
#         'variant:descriptionTab1Content:nl',
#         'variant:descriptionTab1Content:en',
        'variant:shortdescription',   # Added to columns
#         'variant:shortdescription:nl',   # Added to columns
#         'variant:shortdescription:en',   # Added to columns
        'variant:optionTab1Label',
        'variant:optionTab1Visible',
        'variant:optionTab1Bar1Name',
        'variant:optionTab1Bar1Visible',
        'variant:optionTab1Bar1Min',
        'variant:optionTab1Bar1Max',
        'variant:optionTab1Bar1MinLabel',
        'variant:optionTab1Bar1MaxLabel',
        'variant:optionTab1Bar1Rating',
        'variant:optionTab1Bar2Name',
        'variant:optionTab1Bar2Visible',
        'variant:optionTab1Bar2Min',
        'variant:optionTab1Bar2Max',
        'variant:optionTab1Bar2MinLabel',
        'variant:optionTab1Bar2MaxLabel',
        'variant:optionTab1Bar2Rating',
        'variant:optionTab2Label',
        'variant:optionTab2Visible',
        'variant:optionTab2Bar1Name',
        'variant:optionTab2Bar1Visible',
        'variant:optionTab2Bar1MinLabel',
        'variant:optionTab2Bar1MaxLabel',
        'variant:optionTab2Bar1Rating',
        'variant:optionTab2Bar2Name',      # New Field
        'variant:optionTab2Bar2Visible',   # New Field
        'variant:optionTab2Bar2MinLabel',  # New Field
        'variant:optionTab2Bar2MaxLabel',  # New Field
        'variant:optionTab2Bar2Rating',    # New Field
        'variant:optionTab2Bar3Name',      # New Field
        'variant:optionTab2Bar3Visible',   # New Field
        'variant:optionTab2Bar3MinLabel',  # New Field
        'variant:optionTab2Bar3MaxLabel',  # New Field
        'variant:optionTab2Bar3Rating',    # New Field
        'variant:noseWidth',
        'variant:waistWidth',
        'variant:tailWidth',
        'variant:taper',
        'variant:boardWidth',
        'variant:bootLengthMax',
        'variant:effectiveEdge',
        'variant:averageSidecutRadius',
        'variant:setback',
        'variant:stanceMin',
        'variant:stanceMax',
        'variant:weightKg',
        'variant:bindingSizeVariant',
        'variant:riderLengthMin',
        'variant:riderLengthMax',
        'variant:riderWeightMin',
        'variant:riderWeightMax',
        # Add variant option values
#         'variant:optionValue1',  # Corresponds to the first option group
#         'variant:optionValue2',  # Corresponds to the second option group
        # Add more if there are more option groups
        'variant:frontPhoto',
        'variant:backPhoto',
    ]

    # Identify option group and value columns (assuming they start with 'optionGroups #1', 'optionValues #1', etc.)
    option_group_columns = sorted(
        [col for col in source_data.columns if re.match(r'option(?:\s*Groups?)\s*#\d+', col, re.IGNORECASE)],
        key=lambda x: int(re.search(r'#(\d+)', x).group(1))
    )
    option_value_columns = sorted(
        [col for col in source_data.columns if re.match(r'option(?:\s*Values?)\s*#\d+', col, re.IGNORECASE)],
        key=lambda x: int(re.search(r'#(\d+)', x).group(1))
    )

    # Debugging: Print identified option group and value columns
    print("Identified Option Group Columns:", option_group_columns)
    print("Identified Option Value Columns:", option_value_columns)

    # Determine the maximum number of option groups to dynamically add variant:optionValueX fields
    max_option_groups = max(len(option_group_columns), len(option_value_columns))

    # Dynamically add 'variant:optionValueX' to columns if needed
    for i in range(3, max_option_groups + 1):
        columns.append(f'variant:optionValue{i}')

    # Initialize a list to collect all rows
    all_rows = []

    # Group the source data by 'slug' to handle products with multiple variants
    grouped_data = source_data.groupby('slug')

    for slug, group in grouped_data:
        first_row = True
        for _, row in group.iterrows():
            new_row = {}

            if first_row:
                # Assign product-level fields
                new_row['name'] = clean_and_convert(row, 'name', 'string')
                new_row['slug'] = clean_and_convert(row, 'slug', 'string')
                new_row['description'] = clean_html(row.get('product:shortdescription HTML:en', ''))
#                 new_row['description:en'] = clean_html(row.get('product:shortdescription HTML:en', ''))
#                 new_row['description:nl'] = clean_html(row.get('product:shortdescription HTML:nl', ''))
                new_row['assets'] = clean_and_convert(row, 'assets', 'string')
                new_row['facets'] = process_facets(row)
            else:
                # For subsequent variants, leave product-level fields empty
                new_row['name'] = ''
                new_row['slug'] = ''
                new_row['description'] = ''
#                 new_row['description:en'] = ''
#                 new_row['description:nl'] = ''
                new_row['assets'] = ''
                new_row['facets'] = ''

            # General product fields (applied to all variants)
            new_row['sku'] = clean_and_convert(row, 'sku', 'string')
            new_row['price'] = clean_and_convert(row, 'price', 'float')
            new_row['taxCategory'] = clean_and_convert(row, 'taxCategory', 'string')
            new_row['stockOnHand'] = 999999
            new_row['trackInventory'] = True
            new_row['variantAssets'] = clean_and_convert(row, 'variantAssets', 'string')
            new_row['variantFacets'] = clean_and_convert(row, 'variantFacets', 'string')
            new_row['variant:frontPhoto'] = clean_and_convert(row, 'Carrouselasset: topPhoto', 'relation')
            new_row['variant:backPhoto'] = clean_and_convert(row, 'Carrouselasset: BasePhoto', 'relation')

            # Preserve 'variant:shortdescription' logic
            new_row['variant:shortdescription'] = clean_html(row.get('product:shortdescription HTML:en', ''))
#             new_row['variant:shortdescription:nl'] = clean_html(row.get('product:shortdescription HTML:nl', ''))
#             new_row['variant:shortdescription:en'] = clean_html(row.get('product:shortdescription HTML:en', ''))

            # Combine OptionGroups and OptionValues with a pipe
            optionGroups_str, optionValues_str = combine_option_groups_and_values(row, option_group_columns, option_value_columns)
            new_row['optionGroups'] = optionGroups_str if first_row else ''
            new_row['optionValues'] = optionValues_str

            # Debugging: Check if optionGroups and optionValues are non-empty
            if first_row:
                if not new_row['optionGroups']:
                    print(f"Warning: Product '{slug}' has empty 'optionGroups'. Please check the source data.")
                if not new_row['optionValues']:
                    print(f"Warning: Product '{slug}' has empty 'optionValues'. Please check the source data.")

            # Process description tabs
            new_row['variant:descriptionTab1Label'] = 'Description'
            new_row['variant:descriptionTab1Visible'] = True
            new_row['variant:descriptionTab1Content'] = clean_html(row.get('product:longdescription HTML:en', ''))
#             new_row['variant:descriptionTab1Content:nl'] = clean_html(row.get('product:longdescription HTML:nl', ''))
#             new_row['variant:descriptionTab1Content:en'] = clean_html(row.get('product:longdescription HTML:en', ''))


            new_row['variant:noseWidth'] = clean_and_convert(row, 'variant:nose width(cm)', 'float')
            new_row['variant:waistWidth'] = clean_and_convert(row, 'variant:waist width(cm)', 'float')
            new_row['variant:tailWidth'] = clean_and_convert(row, 'variant:tail width(cm)', 'float')
            new_row['variant:taper'] = clean_and_convert(row, 'variant: Taper(cm)', 'float')
            new_row['variant:boardWidth'] = clean_and_convert(row, 'variant:boardwidth(cm)', 'string')
            new_row['variant:bootLengthMax'] = clean_and_convert(row, 'variant:bootlength-max(cm)', 'float')
            new_row['variant:effectiveEdge'] = clean_and_convert(row, 'variant:effective edge(cm)', 'float')
            new_row['variant:averageSidecutRadius'] = clean_and_convert(row, 'variant:average sidecut radius(m)', 'string')
            new_row['variant:setback'] = clean_and_convert(row, 'variant: setback(cm)', 'float')
            new_row['variant:flex'] = clean_and_convert(row, 'variant:flex', 'string')
            new_row['variant:stanceMin'] = clean_and_convert(row, 'variant: stance-min(cm)', 'float')
            new_row['variant:stanceMax'] = clean_and_convert(row, 'variant: Stance-max(cm)', 'float')
            new_row['variant:weightKg'] = clean_and_convert(row, 'variant: Weight(kg)', 'float')
            new_row['variant:bindingSizeVariant'] = clean_and_convert(row, 'variant:bindingsize', 'string')
            new_row['variant:riderLengthMin'] = clean_and_convert(row, 'variant:riderlength-min', 'float')
            new_row['variant:riderLengthMax'] = clean_and_convert(row, 'variant:riderlength-max', 'float')
            new_row['variant:riderWeightMin'] = clean_and_convert(row, 'variant:riderlength-max', 'float')
            new_row['variant:riderWeightMax'] = clean_and_convert(row, 'variant:riderlength-max', 'float')


            if first_row:
                new_row['product:brand'] = clean_and_convert(row, 'product:Brand', 'string')
                new_row['product:warranty'] = clean_and_convert(row, 'product:warranty', 'string')
                new_row['product:eanCode'] = clean_and_convert(row, 'Product:EAN code', 'string')
                new_row['product:quote'] = clean_and_convert(row, 'product:quote', 'string')
                new_row['product:quoteOwner'] = clean_and_convert(row, 'product:quote-owner', 'string')
                new_row['product:boardCategory'] = clean_and_convert(row, 'Product:boardcategory', 'string')
                new_row['product:terrain'] = clean_and_convert(row, 'Product:terrain', 'string')
                new_row['product:camberProfile'] = clean_and_convert(row, 'Product:camberprofile', 'string')
                new_row['product:profile'] = clean_and_convert(row, 'Product:profile', 'string')
                new_row['product:baseProfile'] = clean_and_convert(row, 'Product:baseprofile', 'string')
                new_row['product:rider'] = clean_and_convert(row, 'Product:rider', 'string')
                new_row['product:taperProfile'] = clean_and_convert(row, 'Product: Taper profile', 'string')
                new_row['product:bindingSize'] = clean_and_convert(row, 'Product:bindingsize', 'string')
                new_row['product:bindingMount'] = clean_and_convert(row, 'Product: bindingmount', 'string')
                new_row['product:edges'] = clean_and_convert(row, 'Product: edges', 'string')
                new_row['product:sidewall'] = clean_and_convert(row, 'Product: Sidewall', 'string')
                new_row['product:core'] = clean_and_convert(row, 'Product: Core', 'string')
                new_row['product:layup1'] = clean_and_convert(row, 'Product: lay-up', 'string')
                new_row['product:layup2'] = clean_and_convert(row, 'Product: lay-up', 'string')
                new_row['product:layup3'] = clean_and_convert(row, 'Product: lay-up', 'string')
                new_row['product:boardbase'] = clean_and_convert(row, 'Product: base', 'string')
            else:
                new_row['product:brand'] = ''
                new_row['product:warranty'] = ''
                new_row['product:eanCode'] = ''
                new_row['product:quote'] = ''
                new_row['product:quoteOwner'] = ''
                new_row['product:boardCategory'] = ''
                new_row['product:terrain'] = ''
                new_row['product:camberProfile'] = ''
                new_row['product:profile'] = ''
                new_row['product:baseProfile'] = ''
                new_row['product:rider'] = ''
                new_row['product:taperProfile'] = ''
                new_row['product:bindingSize'] = ''
                new_row['product:bindingMount'] = ''
                new_row['product:edges'] = ''
                new_row['product:sidewall'] = ''
                new_row['product:core'] = ''
                new_row['product:layup1'] = ''
                new_row['product:layup2'] = ''
                new_row['product:layup3'] = ''
                new_row['product:boardbase'] = ''


            # Process OptionTab1 bars
            tab1_bars_info = [
                ('Difficulty rider level rating', 'variant:Riderlevel'),
                ('Difficulty flex rating', 'variant:Flex'),
            ]
            tab1_bars, tab1_visible = parse_and_process_bars(row, tab1_bars_info, tab_id=1)
            new_row['variant:optionTab1Label'] = 'Rider level'
            new_row['variant:optionTab1Visible'] = str(tab1_visible)
            for i, bar in enumerate(tab1_bars, start=1):
                new_row[f'variant:optionTab1Bar{i}Name'] = bar['name']
                new_row[f'variant:optionTab1Bar{i}Visible'] = str(bar['visible'])
                new_row[f'variant:optionTab1Bar{i}MinLabel'] = bar['minLabel']
                new_row[f'variant:optionTab1Bar{i}MaxLabel'] = bar['maxLabel']
                new_row[f'variant:optionTab1Bar{i}Min'] = bar['min']
                new_row[f'variant:optionTab1Bar{i}Max'] = bar['max']
                new_row[f'variant:optionTab1Bar{i}Rating'] = bar['rating']

            # Process OptionTab2 bars
            tab2_bars_info = [
                ('Powder', 'variant:Powder'),
                ('All Mountain', 'variant:All mountain'),
                ('Resort', 'variant:Freestyle'),
            ]
            tab2_bars, tab2_visible = parse_and_process_bars(row, tab2_bars_info, tab_id=2)
            new_row['variant:optionTab2Label'] = 'Terrain'
            new_row['variant:optionTab2Visible'] = str(tab2_visible)
            for i, bar in enumerate(tab2_bars, start=1):
                new_row[f'variant:optionTab2Bar{i}Name'] = bar['name']
                new_row[f'variant:optionTab2Bar{i}Visible'] = str(bar['visible'])
                new_row[f'variant:optionTab2Bar{i}MinLabel'] = bar['minLabel']
                new_row[f'variant:optionTab2Bar{i}MaxLabel'] = bar['maxLabel']
                new_row[f'variant:optionTab2Bar{i}Rating'] = bar['rating']

            # Add rows to the list
            all_rows.append(new_row)

            # Mark that the first row has been processed
            first_row = False

    # Create DataFrame from all collected rows
    converted_data = pd.DataFrame(all_rows, columns=columns)

    # Debugging: Preview descriptions
    print("Sample 'description' and 'variant:descriptionTab1Content' data:")
    print(converted_data[['slug', 'description', 'variant:descriptionTab1Content']].head())

    # Optional: Fill NaN with empty strings to avoid issues in CSV
    converted_data.fillna('', inplace=True)

    try:
        converted_data.to_csv(output_file, index=False)
        print(f"File saved to {output_file}")
    except Exception as e:
        print(f"Error saving output file: {e}")



def parse_arguments():
    parser = argparse.ArgumentParser(
        description='Map PIM Excel data to CSV format for Vendure import.'
    )
    parser.add_argument(
        'input_file',
        type=str,
        help='Path to the input Excel file (e.g., master.xlsx)'
    )
    parser.add_argument(
        'output_file',
        type=str,
        help='Path to the output CSV file (e.g., mapped.csv)'
    )
    return parser.parse_args()

def main():
    args = parse_arguments()

    # Validate input file extension
    if not args.input_file.lower().endswith(('.xlsx', '.xls')):
        print("Error: Input file must be an Excel file with extension .xlsx or .xls")
        sys.exit(1)

    # Validate output file extension
    if not args.output_file.lower().endswith('.csv'):
        print("Error: Output file must have a .csv extension")
        sys.exit(1)

    convert_source_to_products(args.input_file, args.output_file)

if __name__ == '__main__':
    main()
