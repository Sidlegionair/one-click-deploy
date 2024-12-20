import pandas as pd
import re

allowed_tags = [
    '<b>', '</b>', '<i>', '</i>', '<strong>', '</strong>',
    '<em>', '</em>', '<br>', '</br>', '<ul>', '</ul>', '<li>', '</li>',
    '<p>', '</p>', '<a>', '</a>', '<span>', '</span>',
    '<h1>', '</h1>', '<h2>', '</h2>', '<h3>', '</h3>',
    '<div>', '</div>', '<img>', '<hr>'
]
cleanr = re.compile(r'<(?!/?(?:' + '|'.join(tag[1:-1] for tag in allowed_tags) + r')\b)[^>]*>')

def clean_html(raw_html):
    """
    Remove unnecessary HTML tags while preserving essential ones.
    Args:
        raw_html (str): String containing HTML.
    Returns:
        str: Partially cleaned string.
    """
    if pd.isna(raw_html):
        return ''
    return re.sub(cleanr, '', str(raw_html))

def parse_rating(value):
    """
    Parse a rating value, converting decimals to percentages if needed.
    """
    try:
        if pd.isna(value) or value == '':
            return ''
        value_str = str(value).replace('%', '').strip()
        val = float(value_str)
        if val <= 1:
            val = val * 100
        return val
    except:
        return ''

def process_facets(row, facet_columns):
    """
    Process and merge facets, ensuring proper formatting and excluding invalid values.
    """
    facets = []
    for col in facet_columns:
        raw_facet = row.get(col, '')
        if pd.isna(raw_facet):
            continue
        raw_facet = str(raw_facet).strip()
        if raw_facet.lower() != 'nan' and raw_facet != '':
            parts = [p.strip() for p in raw_facet.split(',')]
            for facet in parts:
                if ':' in facet:
                    key, values = facet.split(':', 1)
                    values = '|'.join(v.strip() for v in values.split(','))
                    facets.append(f"{key}:{values}")
                else:
                    facets.append(f"unknown:{facet}")
    return '|'.join(facets)

def process_row(row, facet_columns):
    # Clean and use HTML from product:shortdescription HTML and product:longdescription HTML
    product_short_desc = clean_html(row.get('product:shortdescription HTML', ''))
    product_long_desc = clean_html(row.get('product:longdescription HTML', ''))
    brand = str(row.get('product:Brand', ''))
    price = row.get('price', 0)
    if pd.isna(price):
        price = 0
    taxCategory = row.get('taxCategory', 'standard')
    if pd.isna(taxCategory):
        taxCategory = 'standard'
    stockOnHand = row.get('stockOnHand', 100)
    if pd.isna(stockOnHand):
        stockOnHand = 100
    facets = process_facets(row, facet_columns)

    # Ratings
    diff_rider_rating = parse_rating(row.get('product:Difficulty riderlevel rating ', ''))
    diff_flex_rating = parse_rating(row.get('product:Difficulty flex rating ', ''))
    powder_rating = parse_rating(row.get('Product:POWDER terrainlevel rating ', ''))
    all_mountain_rating = parse_rating(row.get('Product:ALL MOUNTAIN terrainlevel rating ', ''))
    resort_rating = parse_rating(row.get('product:RESORT terrainlevel rating ', ''))
    park_rating = parse_rating(row.get('Product:PARK terrainlevel rating ', ''))

    base = {
        'name': str(row.get('name', '')) if str(row.get('name', '')).lower() != 'nan' else '',
        'slug': str(row.get('slug', '')) if str(row.get('slug', '')).lower() != 'nan' else '',
        # Initially set description to this row's product_short_desc.
        # We'll later adjust based on line type (product line or variant line)
        'description': product_short_desc,
        'variation:shortdescription': '',
        'assets': 'Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-5-5-P.png|Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-5-5-PP.png|Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-5-5-PP-TOP-125x735.png|Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-5-5-profile-side.png|Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-5-5-profile-top.png|Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-5-5-P-TOP-125x735.png|Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-5-5-STD.png|Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-5-5-STD-TOP-125x735.png|Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-X5-130x735.png',
        'facets': facets,
        'optionGroups': '',
        'optionValues': '',
        'sku': '',
        'price': price,
        'taxCategory': taxCategory,
        'stockOnHand': stockOnHand,
        'trackInventory': True,
        'variantAssets': '',
        'variantFacets': '',
        'variant:descriptionTab1Label': 'Long Description',
        'variant:descriptionTab1Visible': True,
        'variant:descriptionTab1Content': product_long_desc,
        'product:brand': brand,

        # Tab 1 (Character)
        'variant:optionTab1Label': 'Character',
        'variant:optionTab1Visible': True,
        'variant:optionTab1Bar1Name': 'Difficulty rider level rating',
        'variant:optionTab1Bar1Visible': True,
        'variant:optionTab1Bar1Min': '10',
        'variant:optionTab1Bar1Max': '100',
        'variant:optionTab1Bar1MinLabel': '10%',
        'variant:optionTab1Bar1MaxLabel': '100%',
        'variant:optionTab1Bar1Rating': diff_rider_rating,

        'variant:optionTab1Bar2Name': 'Difficulty flex rating',
        'variant:optionTab1Bar2Visible': True,
        'variant:optionTab1Bar2Min': '10',
        'variant:optionTab1Bar2Max': '100',
        'variant:optionTab1Bar2MinLabel': '10%',
        'variant:optionTab1Bar2MaxLabel': '100%',
        'variant:optionTab1Bar2Rating': diff_flex_rating,

        # Tab 2 (Terrain) with order: Powder, All Mountain, Resort, Freestyle/Park
        'variant:optionTab2Label': 'Terrain',
        'variant:optionTab2Visible': True,

        'variant:optionTab2Bar1Name': 'Powder',
        'variant:optionTab2Bar1Visible': True,
        'variant:optionTab2Bar1MinLabel': '10%',
        'variant:optionTab2Bar1MaxLabel': '100%',
        'variant:optionTab2Bar1Min': '10',
        'variant:optionTab2Bar1Max': '100',
        'variant:optionTab2Bar1Rating': powder_rating,

        'variant:optionTab2Bar2Name': 'All Mountain',
        'variant:optionTab2Bar2Visible': True,
        'variant:optionTab2Bar2MinLabel': '10%',
        'variant:optionTab2Bar2MaxLabel': '100%',
        'variant:optionTab2Bar2Min': '10',
        'variant:optionTab2Bar2Max': '100',
        'variant:optionTab2Bar2Rating': all_mountain_rating,

        'variant:optionTab2Bar3Name': 'Resort',
        'variant:optionTab2Bar3Visible': True,
        'variant:optionTab2Bar3MinLabel': '10%',
        'variant:optionTab2Bar3MaxLabel': '100%',
        'variant:optionTab2Bar3Min': '10',
        'variant:optionTab2Bar3Max': '100',
        'variant:optionTab2Bar3Rating': resort_rating,

        'variant:optionTab2Bar4Name': 'Freestyle/Park',
        'variant:optionTab2Bar4Visible': True,
        'variant:optionTab2Bar4MinLabel': '10%',
        'variant:optionTab2Bar4MaxLabel': '100%',
        'variant:optionTab2Bar4Min': '10',
        'variant:optionTab2Bar4Max': '100',
        'variant:optionTab2Bar4Rating': park_rating,

#         'variant:frontPhoto': 'Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-5-5-STD-TOP-125x735.png',
#         'variant:backPhoto': 'Dupraz/Dupraz D1-5-5-165/Dupraz-snowboards-D1-X5-130x735.png'
        'variant:frontPhoto': '',
        'variant:backPhoto': ''
    }
    return base

def convert_source_to_products(source_file, output_file):
    """
    Convert source Excel data to Vendure format.
    If no variants (just one line): description = product_shortdesc, variation:shortdescription = ''
    If variants:
        First line (product line): description = product_shortdesc, variation:shortdescription = ''
        Subsequent variants: description = '', variation:shortdescription = product_shortdesc from their own row
    """
    try:
        source_data = pd.read_excel(source_file)
        print("Source data loaded successfully.")
    except Exception as e:
        print(f"Error loading source file: {e}")
        return

    # Identify facet columns
    facet_columns = [col for col in source_data.columns if col.startswith('facets.')]

    # Check for multiple variants
    option_group_col = 'optionGroups #1'
    option_value_col = 'option Values #1'
    has_options = (option_group_col in source_data.columns and option_value_col in source_data.columns)

    if 'name' in source_data.columns and 'slug' in source_data.columns:
        grouped = source_data.groupby(['name', 'slug'], dropna=False)
    else:
        grouped = [((None, None), source_data)]

    columns = [
        'name', 'slug', 'description', 'variation:shortdescription', 'assets', 'facets', 'optionGroups', 'optionValues', 'sku', 'price', 'taxCategory',
        'stockOnHand', 'trackInventory', 'variantAssets', 'variantFacets',
        'variant:descriptionTab1Label', 'variant:descriptionTab1Visible', 'variant:descriptionTab1Content', 'product:brand',
        'variant:optionTab1Label', 'variant:optionTab1Visible', 'variant:optionTab1Bar1Name', 'variant:optionTab1Bar1Visible',
        'variant:optionTab1Bar1Min', 'variant:optionTab1Bar1Max', 'variant:optionTab1Bar1MinLabel', 'variant:optionTab1Bar1MaxLabel',
        'variant:optionTab1Bar1Rating', 'variant:optionTab1Bar2Name', 'variant:optionTab1Bar2Visible', 'variant:optionTab1Bar2Min',
        'variant:optionTab1Bar2Max', 'variant:optionTab1Bar2MinLabel', 'variant:optionTab1Bar2MaxLabel', 'variant:optionTab1Bar2Rating',
        'variant:optionTab2Label', 'variant:optionTab2Visible',
        'variant:optionTab2Bar1Name','variant:optionTab2Bar1Visible','variant:optionTab2Bar1MinLabel','variant:optionTab2Bar1MaxLabel',
        'variant:optionTab2Bar1Min','variant:optionTab2Bar1Max','variant:optionTab2Bar1Rating',
        'variant:optionTab2Bar2Name','variant:optionTab2Bar2Visible','variant:optionTab2Bar2MinLabel','variant:optionTab2Bar2MaxLabel',
        'variant:optionTab2Bar2Min','variant:optionTab2Bar2Max','variant:optionTab2Bar2Rating',
        'variant:optionTab2Bar3Name','variant:optionTab2Bar3Visible','variant:optionTab2Bar3MinLabel','variant:optionTab2Bar3MaxLabel',
        'variant:optionTab2Bar3Min','variant:optionTab2Bar3Max','variant:optionTab2Bar3Rating',
        'variant:optionTab2Bar4Name','variant:optionTab2Bar4Visible','variant:optionTab2Bar4MinLabel','variant:optionTab2Bar4MaxLabel',
        'variant:optionTab2Bar4Min','variant:optionTab2Bar4Max','variant:optionTab2Bar4Rating',
        'variant:frontPhoto', 'variant:backPhoto'
    ]

    converted_data = []

    for (prod_name, prod_slug), group in (grouped if isinstance(grouped, list) else grouped):
        if pd.isna(prod_name):
            prod_name = ''
        if pd.isna(prod_slug):
            prod_slug = ''

        first_row = group.iloc[0]
        product_info = process_row(first_row, facet_columns)
        # product_info currently contains product-level shortdesc from the first row.

        if has_options:
            option_group_values = group[option_group_col].dropna().unique()
            if len(option_group_values) > 0:
                og = option_group_values[0]
                option_values = group[option_value_col].dropna().unique()

                if len(option_values) == 0:
                    # No option values, single variant line = product line only
                    variant_line = product_info.copy()
                    sku = str(first_row.get('sku', f"{prod_slug}_default"))
                    if pd.isna(sku) or sku.lower() == 'nan':
                        sku = f"{prod_slug}_default"
                    variant_line['sku'] = sku
                    # description = product_short_desc from first_row
                    # variation:shortdescription = ''
                    converted_data.append(variant_line)
                else:
                    # First variant line = product line
                    first_val = option_values[0]
                    variant_line = product_info.copy()
                    variant_line['optionGroups'] = og
                    variant_line['optionValues'] = first_val
                    sku = first_row.get('sku', f"{prod_slug}_{first_val}")
                    if pd.isna(sku) or str(sku).lower() == 'nan':
                        sku = f"{prod_slug}_{first_val}"
                    variant_line['sku'] = sku
                    # First line: use first_row shortdesc for description
                    variant_line['variation:shortdescription'] = ''
                    converted_data.append(variant_line)

                    # Subsequent variants = variation lines
                    for val in option_values[1:]:
                        new_variant = {k: '' for k in columns}
                        # Inherit variant-level info
                        new_variant['optionGroups'] = og
                        new_variant['optionValues'] = val
                        new_variant['price'] = product_info['price']
                        new_variant['taxCategory'] = product_info['taxCategory']
                        new_variant['stockOnHand'] = product_info['stockOnHand']
                        new_variant['trackInventory'] = product_info['trackInventory']

                        # Inherit variant bars and long desc
                        for c in columns:
                            if c.startswith('variant:optionTab') or c in [
                                'variant:descriptionTab1Label','variant:descriptionTab1Visible','variant:descriptionTab1Content',
                                'variant:frontPhoto','variant:backPhoto','product:brand'
                            ]:
                                new_variant[c] = product_info[c]

                        sku = f"{prod_slug}_{val}"
                        new_variant['sku'] = sku

                        # Now, get the unique product shortdesc from this variant's row
                        val_rows = group[group[option_value_col] == val]
                        if len(val_rows) > 0:
                            val_row = val_rows.iloc[0]
                        else:
                            val_row = first_row  # fallback if no match

                        unique_short_desc = clean_html(val_row.get('product:shortdescription HTML', ''))

                        # Subsequent variants: description = '', variation:shortdescription = unique product short desc
                        new_variant['description'] = ''
                        new_variant['variation:shortdescription'] = unique_short_desc
                        converted_data.append(new_variant)

            else:
                # No option groups, single variant line = product line only
                variant_line = product_info.copy()
                sku = str(first_row.get('sku', f"{prod_slug}_default"))
                if pd.isna(sku) or sku.lower() == 'nan':
                    sku = f"{prod_slug}_default"
                variant_line['sku'] = sku
                # description = product_short_desc from this single line
                # variation:shortdescription = ''
                converted_data.append(variant_line)
        else:
            # No options at all, single line only product line
            variant_line = product_info.copy()
            sku = str(first_row.get('sku', f"{prod_slug}_default"))
            if pd.isna(sku) or sku.lower() == 'nan':
                sku = f"{prod_slug}_default"
            variant_line['sku'] = sku
            # description = product_short_desc from this single line
            # variation:shortdescription = ''
            converted_data.append(variant_line)

    df = pd.DataFrame(converted_data, columns=columns)
    # Replace True/False with 'true'/'false'
    df = df.replace({True:'true',False:'false','nan':''}, regex=True)

    try:
        df.to_csv(output_file, index=False)
        print(f"File saved to {output_file}")
    except Exception as e:
        print(f"Error saving output file: {e}")

if __name__ == "__main__":
    import sys

    if len(sys.argv) != 3:
        print("Usage: python3 convert_pim_to_products.py <source_file> <output_file>")
        sys.exit(1)

    source_file = sys.argv[1]
    output_file = sys.argv[2]

    convert_source_to_products(source_file, output_file)
