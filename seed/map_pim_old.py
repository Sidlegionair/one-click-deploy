import pandas as pd
import re

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
    try:
        if not value:
            return float('nan')
        if isinstance(value, (float, int)):
            return value * 100 if value <= 1 else value
        value = str(value).replace('%', '').strip()
        return float(value) * 100 if float(value) <= 1 else float(value)
    except (ValueError, TypeError):
        return float('nan')

def should_tab_be_visible(tab_bars):
    return any(bar['visible'] for bar in tab_bars)

def parse_and_process_bars(row, bar_info, tab_id=None):
    bars = []
    for i, (bar_name, source_key) in enumerate(bar_info, start=1):
        rating = parse_rating(row.get(source_key, ''))
        visible = not pd.isna(rating) and rating > 0

        # Default labels
        min_label = ''
        max_label = ''

        # Set tab-specific labels
        if tab_id == 1:  # Tab 1
            if i == 1:
                min_label = 'Beginner'
                max_label = 'Expert'
            elif i == 2:
                min_label = 'Soft'
                max_label = 'Stiff'
        elif tab_id == 2:  # Tab 2
            if i == 1:
                min_label = ''
                max_label = ''
            elif i == 2:
                min_label = ''
                max_label = ''
            elif i == 3:
                min_label = ''
                max_label = ''

        bars.append({
            'name': bar_name,
            'visible': visible,
            'rating': rating if visible else '',
            'minLabel': min_label if visible else '',
            'maxLabel': max_label if visible else '',
            'min': '10',
            'max': '100',
        })
    return bars, should_tab_be_visible(bars)

def combine_option_groups_and_values(row, option_groups, option_values):
    """
    Combine OptionGroups and OptionValues into a formatted string.
    Args:
        row (pd.Series): The current row being processed.
        option_groups (list): List of column names for OptionGroups.
        option_values (list): List of column names for OptionValues.
    Returns:
        tuple: Combined OptionGroups and OptionValues strings.
    """
    groups = []
    values = []
    for group_col, value_col in zip(option_groups, option_values):
        group = row.get(group_col, '')
        value = row.get(value_col, '')
        if not pd.isna(group) and not pd.isna(value):
            groups.append(str(group).strip())
            values.append(str(value).strip())
    return '|'.join(groups), '|'.join(values)

def process_facets(row, facet_columns):
    facets = set()  # Use a set to automatically filter out duplicates
    for col in facet_columns:
        raw_facet = row.get(col, '')
        if pd.isna(raw_facet):
            continue
        raw_facet = str(raw_facet).strip()
        if raw_facet.lower() != 'nan':
            parts = [facet.strip() for facet in raw_facet.split(',')]
            for facet in parts:
                if ':' in facet:
                    key, values = facet.split(':', 1)
                    values = '|'.join(v.strip() for v in values.split(','))
                    facets.add(f"{key}:{values}")
                else:
                    facets.add(f"unknown:{facet}")
    return '|'.join(sorted(facets))  # Sort the facets for consistent output

def convert_source_to_products(source_file, output_file):
    try:
        source_data = pd.read_excel(source_file)
        print("Source data loaded successfully.")
    except Exception as e:
        print(f"Error loading source file: {e}")
        return

    columns = ['name', 'slug', 'description', 'assets', 'facets', 'optionGroups', 'optionValues', 'sku', 'price', 'taxCategory',
               'stockOnHand', 'trackInventory', 'variantAssets', 'variantFacets',
               'variant:descriptionTab1Label', 'variant:descriptionTab1Visible', 'variant:descriptionTab1Content', 'product:brand',
               'variant:optionTab1Label', 'variant:optionTab1Visible', 'variant:optionTab1Bar1Name', 'variant:optionTab1Bar1Visible',
               'variant:optionTab1Bar1Min', 'variant:optionTab1Bar1Max', 'variant:optionTab1Bar1MinLabel', 'variant:optionTab1Bar1MaxLabel',
               'variant:optionTab1Bar1Rating', 'variant:optionTab2Label', 'variant:optionTab2Visible',
               'variant:optionTab2Bar1Name', 'variant:optionTab2Bar1Visible', 'variant:optionTab2Bar1MinLabel', 'variant:optionTab2Bar1MaxLabel']

    facet_columns = [col for col in source_data.columns if col.startswith('facets.')]
    option_group_columns = [col for col in source_data.columns if col.startswith('optionGroups')]
    option_value_columns = [col for col in source_data.columns if col.startswith('option Values')]

    converted_data = pd.DataFrame(columns=columns)

    grouped_data = source_data.groupby('slug')
    for slug, group in grouped_data:
        first_row = True
        for _, row in group.iterrows():
            new_row = {}

            # Fill specific fields only for the first row in the group
            new_row['name'] = str(row.get('name', '')) if first_row else ''
            new_row['slug'] = str(row.get('slug', '')) if first_row else ''
            new_row['description'] = clean_html(row.get('product:shortdescription HTML', '')) if first_row else ''
            new_row['assets'] = row.get('assets', '') if first_row else ''
            new_row['facets'] = process_facets(row, facet_columns) if first_row else ''

            new_row['sku'] = str(row.get('sku', ''))
            new_row['price'] = row.get('price', 0)
            new_row['taxCategory'] = row.get('taxCategory', 'standard')
            new_row['stockOnHand'] = row.get('stockOnHand', 100)  # Default to 100
            new_row['trackInventory'] = False  # Default to False
            new_row['variantAssets'] = row.get('variantAssets', '')
            new_row['variant:frontPhoto'] = row.get('Carrouselasset: topPhoto', '')
            new_row['variant:backPhoto'] = row.get('Carrouselasset: BasePhoto', '')

            new_row['variant:shortdescription'] = '' if first_row else row.get('product:shortdescription HTML', '')


            # Combine OptionGroups and OptionValues
            option_groups, option_values = combine_option_groups_and_values(row, option_group_columns, option_value_columns)
            new_row['optionGroups'] = option_groups if first_row else ''
            new_row['optionValues'] = option_values

            # Process description tabs
            new_row['variant:descriptionTab1Label'] = 'Long Description'
            new_row['variant:descriptionTab1Visible'] = 'True'
            new_row['variant:descriptionTab1Content'] = clean_html(row.get('product:longdescription HTML', ''))
            new_row['product:brand'] = row.get('product:Brand', '')

            # Process OptionTab1 bars
            tab1_bars_info = [
                ('Difficulty rider level rating', 'variant:Riderlevel  '),
                ('Difficulty flex rating', 'variant:Flex '),
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
                ('Powder', 'variant:Powder '),
                ('All Mountain', 'variant:All mountain  '),
                ('Resort', 'variant:Freestyle '),
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


            # Add rows to the DataFrame
            converted_data = pd.concat([converted_data, pd.DataFrame([new_row])], ignore_index=True)
            first_row = False

    try:
        converted_data.to_csv(output_file, index=False)
        print(f"File saved to {output_file}")
    except Exception as e:
        print(f"Error saving output file: {e}")

# Example usage:
if __name__ == "__main__":
    import sys

    if len(sys.argv) != 3:
        print("Usage: python convert_pim_to_products.py <source_file> <output_file>")
        sys.exit(1)

    source_file = sys.argv[1]
    output_file = sys.argv[2]

    convert_source_to_products(source_file, output_file)
