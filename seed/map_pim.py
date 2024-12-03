import pandas as pd
import re

def clean_html(raw_html):
    """
    Remove unnecessary HTML tags while preserving essential ones.
    Args:
        raw_html (str): String containing HTML.
    Returns:
        str: Partially cleaned string.
    """
    if pd.isna(raw_html):  # Handle NaN values
        return ''
    # Keep essential tags and remove the rest
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
    Parse a rating value, converting decimals to percentages if needed.
    Args:
        value (str or float): The input rating value as a string or float.
    Returns:
        float: The parsed float value or NaN if invalid.
    """
    try:
        # Debug: Log the raw value
        print(f"Raw value to parse: {value}")

        # Handle None or empty string
        if not value:
            print("Value is None or empty.")
            return float('nan')

        # If the value is a float or a string representing a decimal
        if isinstance(value, (float, int)):
            parsed_value = value * 100 if value <= 1 else value
        else:
            # Handle string with % or numeric string
            value = str(value).replace('%', '').strip()
            parsed_value = float(value) * 100 if float(value) <= 1 else float(value)

        # Debug: Log the parsed value
        print(f"Parsed value: {parsed_value}")
        return parsed_value
    except (ValueError, TypeError) as e:
        # Debug: Log the error
        print(f"Error parsing rating: {value} - {e}")
        return float('nan')


def process_facets(row, facet_columns):
    """
    Process and merge facets, ensuring proper formatting and excluding invalid values.
    Args:
        row (pd.Series): The current row of the DataFrame.
        facet_columns (list): List of column names for facets in the source data.
    Returns:
        str: Processed and formatted facets.
    """
    facets = []
    for col in facet_columns:
        raw_facet = row.get(col, '')
        if pd.isna(raw_facet):  # Handle NaN
            continue
        raw_facet = str(raw_facet).strip()
        if raw_facet.lower() != 'nan':
            parts = [facet.strip() for facet in raw_facet.split(',')]
            for facet in parts:
                if ':' in facet:
                    key, values = facet.split(':', 1)
                    values = '|'.join(v.strip() for v in values.split(','))
                    facets.append(f"{key}:{values}")
                else:
                    facets.append(f"unknown:{facet}")
    return '|'.join(facets)

def convert_source_to_products(source_file, output_file):
    """
    Convert a source Excel file to the format of a products.csv file with all specified columns.
    Args:
        source_file (str): Path to the source Excel file.
        output_file (str): Path to save the converted file.
    """
    try:
        # Load the source file
        source_data = pd.read_excel(source_file)
        print("Source data loaded successfully.")
    except Exception as e:
        print(f"Error loading source file: {e}")
        return

    # Define all columns for the output file
    columns = ['name', 'slug', 'description', 'assets', 'facets', 'optionGroups', 'optionValues', 'sku', 'price', 'taxCategory',
               'stockOnHand', 'trackInventory', 'variantAssets', 'variantFacets',
               'variant:descriptionTab1Label', 'variant:descriptionTab1Visible', 'variant:descriptionTab1Content', 'product:brand',
               'variant:optionTab1Label', 'variant:optionTab1Visible', 'variant:optionTab1Bar1Name', 'variant:optionTab1Bar1Visible',
               'variant:optionTab1Bar1Min', 'variant:optionTab1Bar1Max', 'variant:optionTab1Bar1MinLabel', 'variant:optionTab1Bar1MaxLabel',
               'variant:optionTab1Bar1Rating']

    # Define facet columns in the source data
    facet_columns = [col for col in source_data.columns if col.startswith('facets.')]

    # Create an empty DataFrame with the defined columns
    converted_data = pd.DataFrame(columns=columns)

    for index, row in source_data.iterrows():
        new_row = {}

        # Map fields from the source data to the output format
        try:
            new_row['name'] = str(row.get('name', ''))
            new_row['slug'] = str(row.get('slug', ''))
            new_row['sku'] = str(row.get('sku', ''))
            new_row['assets'] = 'Dupraz/Dupraz D1-5-2-158/Dupraz-snowboards-D1-5-2.png|Dupraz/Dupraz D1-5-2-158/Dupraz-snowboards-D1-5-2-profile-side.png|Dupraz/Dupraz D1-5-2-158/Dupraz-snowboards-D1-5-2-profile-top.png|Dupraz/Dupraz D1-5-2-158/Dupraz-snowboards-D1-5-2-TOP-1-305x1780.png|Dupraz/Dupraz D1-5-2-158/Dupraz-snowboards-D1-5-2N.png|Dupraz/Dupraz D1-5-2-158/Dupraz-snowboards-D1-5-2N-TOP-305x1780.png'
            new_row['price'] = row.get('price', 0)  # Default price to 0 if missing
            new_row['taxCategory'] = row.get('taxCategory', 'standard')
            new_row['trackInventory'] = True  # Always set to True
            new_row['optionGroups'] = str(row.get('optionGroups', ''))

            # Process and merge facets
            new_row['facets'] = process_facets(row, facet_columns)

            # Clean descriptions
            new_row['description'] = clean_html(row.get('product:shortdescription HTML', ''))
            
            new_row['variant:descriptionTab1Label'] = 'Long Description'
            new_row['variant:descriptionTab1Visible'] = 'True'
            new_row['variant:descriptionTab1Content'] = clean_html(row.get('product:longdescription HTML', ''))
            new_row['product:brand'] = row.get('product:Brand', '')

            new_row['variant:optionTab1Label'] = 'Performance ratings'
            new_row['variant:optionTab1Visible'] = 'True'

            new_row['variant:optionTab1Bar1Name'] = 'Difficulty rider level rating'
            new_row['variant:optionTab1Bar1Visible'] = 'True'
            new_row['variant:optionTab1Bar1MinLabel'] = '10%'
            new_row['variant:optionTab1Bar1MaxLabel'] = '100%'
            new_row['variant:optionTab1Bar1Min'] = '10'
            new_row['variant:optionTab1Bar1Max'] = '100'
            new_row['variant:optionTab1Bar1Rating'] = parse_rating(row.get('product:Difficulty riderlevel rating ', ''))

            new_row['variant:optionTab1Bar2Name'] = 'Difficulty flex rating'
            new_row['variant:optionTab1Bar2Visible'] = 'True'
            new_row['variant:optionTab1Bar2MinLabel'] = '10%'
            new_row['variant:optionTab1Bar2MaxLabel'] = '100%'
            new_row['variant:optionTab1Bar2Min'] = '10'
            new_row['variant:optionTab1Bar2Max'] = '100'
            new_row['variant:optionTab1Bar2Rating'] = parse_rating(row.get('product:Difficulty flex rating ', ''))


            new_row['variant:optionTab2Label'] = 'Terrain ratings'
            new_row['variant:optionTab2Visible'] = 'True'
            
            new_row['variant:optionTab2Bar1Name'] = 'RESORT terrainlevel rating'
            new_row['variant:optionTab2Bar1Visible'] = 'True'
            new_row['variant:optionTab2Bar1MinLabel'] = '10%'
            new_row['variant:optionTab2Bar1MaxLabel'] = '100%'
            new_row['variant:optionTab2Bar1Min'] = '10'
            new_row['variant:optionTab2Bar1Max'] = '100'
            new_row['variant:optionTab2Bar1Rating'] = parse_rating(row.get('product:RESORT terrainlevel rating ', ''))


            new_row['variant:optionTab2Bar2Name'] = 'ALL MOUNTAIN terrainlevel rating'
            new_row['variant:optionTab2Bar2Visible'] = 'True'
            new_row['variant:optionTab2Bar2MinLabel'] = '10%'
            new_row['variant:optionTab2Bar2MaxLabel'] = '100%'
            new_row['variant:optionTab2Bar2Min'] = '10'
            new_row['variant:optionTab2Bar2Max'] = '100'
            new_row['variant:optionTab2Bar2Rating'] = parse_rating(row.get('Product:ALL MOUNTAIN terrainlevel rating ', ''))

            new_row['variant:optionTab2Bar3Name'] = 'PARK terrainlevel rating'
            new_row['variant:optionTab2Bar3Visible'] = 'True'
            new_row['variant:optionTab2Bar3MinLabel'] = '10%'
            new_row['variant:optionTab2Bar3MaxLabel'] = '100%'
            new_row['variant:optionTab2Bar3Min'] = '10'
            new_row['variant:optionTab2Bar3Max'] = '100'
            new_row['variant:optionTab2Bar3Rating'] = parse_rating(row.get('Product:PARK terrainlevel rating ', ''))


            new_row['variant:optionTab3Label'] = 'Additional'
            new_row['variant:optionTab3Visible'] = 'True'

            new_row['variant:optionTab3Bar1Name'] = 'POWDER terrainlevel rating'
            new_row['variant:optionTab3Bar1Visible'] = 'True'
            new_row['variant:optionTab3Bar1MinLabel'] = '10%'
            new_row['variant:optionTab3Bar1MaxLabel'] = '100%'
            new_row['variant:optionTab3Bar1Min'] = '10'
            new_row['variant:optionTab3Bar1Max'] = '100'
            new_row['variant:optionTab3Bar1Rating'] = parse_rating(row.get('Product:POWDER terrainlevel rating ', ''))

        except Exception as e:
            print(f"Error processing row {index}: {e}")
            continue

        # Append the row to the DataFrame
        converted_data = pd.concat([converted_data, pd.DataFrame([new_row])], ignore_index=True)

    # Save the converted data
    try:
        converted_data.to_csv(output_file, index=False)
        print(f"File saved to {output_file}")
    except Exception as e:
        print(f"Error saving output file: {e}")

# Example usage:
# python3 convert_pim_to_products.py master.xlsx mapped.csv
if __name__ == "__main__":
    import sys

    if len(sys.argv) != 3:
        print("Usage: python convert_pim_to_products.py <source_file> <output_file>")
        sys.exit(1)

    source_file = sys.argv[1]
    output_file = sys.argv[2]

    convert_source_to_products(source_file, output_file)
