def process_row(row, facet_columns, is_main_product):
    """
    Process a single row and return a dictionary with necessary fields.
    """
    # Clean HTML descriptions
    product_short_desc = clean_html(row.get('product:shortdescription HTML', ''))
    product_long_desc = clean_html(row.get('product:longdescription HTML', ''))

    # Extract brand
    brand = str(row.get('product:brand', '')).strip()

    # Extract and handle price
    price = row.get('price', 0)
    if pd.isna(price):
        price = 0

    # Extract and handle tax category
    taxCategory = row.get('taxCategory', 'standard')
    if pd.isna(taxCategory):
        taxCategory = 'standard'

    # Extract and handle stock on hand
    stockOnHand = row.get('stockOnHand', 100)
    if pd.isna(stockOnHand):
        stockOnHand = 100

    # Process facets
    facets = process_facets(row, facet_columns)

    # Parse ratings (if applicable)
    diff_rider_rating = parse_rating(row.get('variant:Riderlevel  ', ''))
    diff_flex_rating = parse_rating(row.get('variant:Flex ', ''))
    powder_rating = parse_rating(row.get('variant:Powder ', ''))
    all_mountain_rating = parse_rating(row.get('variant:All mountain  ', ''))
    freestyle_rating = parse_rating(row.get('variant:Freestyle ', ''))

    # Extract assets from source data
    assets = row.get('assets', '')
    if pd.isna(assets):
        assets = ''

    # Extract variantAssets from source data
    variant_assets = row.get('variantAssets', '')
    if pd.isna(variant_assets):
        variant_assets = ''

    # Extract variant front and back photos from source data
    front_photo = row.get('variant:Carrouselasset: topPhoto', '')
    if pd.isna(front_photo):
        front_photo = ''

    back_photo = row.get('variant:Carrouselasset: BasePhoto', '')
    if pd.isna(back_photo):
        back_photo = ''

    # Construct the base dictionary with all required fields, including custom fields
    base = {
        'name': str(row.get('name', '')).strip() if is_main_product else '',
        'slug': str(row.get('slug', '')).strip() if is_main_product else '',
        'description': product_short_desc if is_main_product else '',
        'variation:shortdescription': '' if is_main_product else '',  # Can be modified if needed
        'assets': assets if is_main_product else '',
        'facets': facets if is_main_product else '',
        'optionGroups': '',   # Will be set only for main products
        'optionValues': '',   # Will be set for both main products and variants
        'sku': '',
        'price': price,
        'taxCategory': taxCategory,
        'stockOnHand': stockOnHand,
        'trackInventory': 'false' if is_main_product and pd.isna(row.get('trackInventory', False)) else 'true',
        'variantAssets': variant_assets if is_main_product else '',
        'variantFacets': '',  # Not used in your desired output

        # Custom Fields
        'variant:descriptionTab1Label': 'Long Description',
        'variant:descriptionTab1Visible': 'true',
        'variant:descriptionTab1Content': product_long_desc,
        'product:brand': brand,

        # Tab 1 (Character)
        'variant:optionTab1Label': 'Character',
        'variant:optionTab1Visible': 'false',

        'variant:optionTab1Bar1Name': 'Difficulty rider level rating',
        'variant:optionTab1Bar1Visible': 'true' if diff_rider_rating else 'false',
        'variant:optionTab1Bar1Min': '10',
        'variant:optionTab1Bar1Max': '100',
        'variant:optionTab1Bar1MinLabel': '',
        'variant:optionTab1Bar1MaxLabel': '',
        'variant:optionTab1Bar1Rating': diff_rider_rating,

        'variant:optionTab1Bar2Name': 'Difficulty flex rating',
        'variant:optionTab1Bar2Visible': 'true' if diff_flex_rating else 'false',
        'variant:optionTab1Bar2Min': '10',
        'variant:optionTab1Bar2Max': '100',
        'variant:optionTab1Bar2MinLabel': '',
        'variant:optionTab1Bar2MaxLabel': '',
        'variant:optionTab1Bar2Rating': diff_flex_rating,

        # Tab 2 (Terrain)
        'variant:optionTab2Label': 'Terrain',
        'variant:optionTab2Visible': 'false',

        'variant:optionTab2Bar1Name': 'Powder',
        'variant:optionTab2Bar1Visible': 'true' if powder_rating else 'false',
        'variant:optionTab2Bar1Min': '10',
        'variant:optionTab2Bar1Max': '100',
        'variant:optionTab2Bar1MinLabel': '',
        'variant:optionTab2Bar1MaxLabel': '',
        'variant:optionTab2Bar1Rating': powder_rating,

        'variant:optionTab2Bar2Name': 'All Mountain',
        'variant:optionTab2Bar2Visible': 'true' if all_mountain_rating else 'false',
        'variant:optionTab2Bar2Min': '10',
        'variant:optionTab2Bar2Max': '100',
        'variant:optionTab2Bar2MinLabel': '',
        'variant:optionTab2Bar2MaxLabel': '',
        'variant:optionTab2Bar2Rating': all_mountain_rating,

        'variant:optionTab2Bar3Name': 'Freestyle',
        'variant:optionTab2Bar3Visible': 'true' if freestyle_rating else 'false',
        'variant:optionTab2Bar3Min': '10',
        'variant:optionTab2Bar3Max': '100',
        'variant:optionTab2Bar3MinLabel': '',
        'variant:optionTab2Bar3MaxLabel': '',
        'variant:optionTab2Bar3Rating': freestyle_rating,

        # Front and Back Photos
        'variant:frontPhoto': front_photo,
        'variant:backPhoto': back_photo
    }

    # Update Tab1 visibility based on Bars' visibility
    if base['variant:optionTab1Bar1Visible'] == 'true' or base['variant:optionTab1Bar2Visible'] == 'true':
        base['variant:optionTab1Visible'] = 'true'

    # Update Tab2 visibility based on Bars' visibility
    if (base['variant:optionTab2Bar1Visible'] == 'true' or
        base['variant:optionTab2Bar2Visible'] == 'true' or
        base['variant:optionTab2Bar3Visible'] == 'true'):
        base['variant:optionTab2Visible'] = 'true'

    return base

def convert_source_to_products(source_file, output_file):
    """
    Convert source Excel data to Vendure format.
    """
    try:
        # Load the source Excel file
        source_data = pd.read_excel(source_file)
        logging.info("Source data loaded successfully.")
    except Exception as e:
        logging.error(f"Error loading source file: {e}")
        sys.exit(1)

    # Identify facet columns (assuming they start with 'facets.')
    facet_columns = [col for col in source_data.columns if col.startswith('facets.')]

    # Identify all option group and option value column pairs
    option_columns = get_option_columns(source_data.columns.tolist())

    if not option_columns:
        logging.warning("No option groups found.")

    # Define the order and names of output columns
    output_columns = [
        'name', 'slug', 'description', 'variation:shortdescription', 'assets', 'facets',
        'optionGroups', 'optionValues', 'sku', 'price', 'taxCategory',
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
        'variant:frontPhoto', 'variant:backPhoto'
    ]

    converted_data = []
    sku_set = set()  # To track unique SKUs
    current_product_slug = None  # To track the current main product's slug

    # Group the data by 'slug' to ensure main products and their variants are processed together
    grouped = source_data.groupby('slug', dropna=False)

    for slug, group in grouped:
        # Reset current_product_slug for each group
        if pd.isna(slug):
            slug = ''
        current_product_slug = str(slug).strip()

        # Identify main product (assuming main product has non-empty 'name')
        main_product = group[group['name'].notna() & (group['name'].str.strip() != '')]
        if main_product.empty:
            logging.warning(f"No main product found for slug '{slug}'. Skipping this group.")
            continue
        main_product = main_product.iloc[0]

        # Process main product row
        main_product_info = process_row(main_product, facet_columns, is_main_product=True)

        # Assign optionGroups and optionValues for main product
        option_groups_list = []
        option_values_list = []
        for group_col, value_col in option_columns:
            option_group = main_product.get(group_col, '')
            if pd.isna(option_group) or str(option_group).strip() == '':
                continue
            option_group = str(option_group).strip()
            option_groups_list.append(option_group)

            option_values = main_product.get(value_col, '')
            if pd.isna(option_values) or str(option_values).strip() == '':
                continue
            # Split multiple option values if present (assuming comma-separated)
            option_values = [str(val).strip() for val in str(option_values).split(',') if str(val).strip() != '']
            option_values_joined = '|'.join(option_values)
            option_values_list.append(option_values_joined)

        main_product_info['optionGroups'] = '|'.join(option_groups_list) if option_groups_list else ''
        main_product_info['optionValues'] = '|'.join(option_values_list) if option_values_list else ''

        # Assign SKU for main product
        sku = main_product.get('sku', '')
        if pd.isna(sku) or str(sku).strip().lower() == 'nan' or str(sku).strip() == '':
            # Generate SKU based on slug
            sku = f"{current_product_slug}_default" if pd.notna(slug) else f"SKU_{len(sku_set)+1}"
        else:
            sku = str(sku).strip()

        # Ensure SKU uniqueness
        original_sku = sku
        counter = 1
        while sku in sku_set:
            sku = f"{original_sku}_{counter}"
            counter += 1
        sku_set.add(sku)
        main_product_info['sku'] = sku

        # Append main product to converted_data
        converted_data.append(main_product_info)

        # Process variant rows (exclude main product)
        variant_rows = group.drop(main_product.name)
        for idx, variant in variant_rows.iterrows():
            # Process variant row
            variant_info = process_row(variant, facet_columns, is_main_product=False)

            # Assign optionValues for variant
            variant_option_values = []
            for _, value_col in option_columns:
                option_value = variant.get(value_col, '')
                if pd.isna(option_value) or option_value == '':
                    continue
                option_value = str(option_value).strip()
                variant_option_values.append(option_value)
            variant_info['optionValues'] = '|'.join(variant_option_values) if variant_option_values else ''

            # Assign SKU for variant
            variant_sku = variant.get('sku', '')
            if pd.isna(variant_sku) or str(variant_sku).strip().lower() == 'nan' or str(variant_sku).strip() == '':
                # Generate SKU based on slug and optionValues
                if variant_option_values:
                    sanitized_options = '_'.join(re.sub(r'[^A-Za-z0-9_]+', '', val.replace(' ', '_')) for val in variant_option_values)
                    variant_sku = f"{slug}_{sanitized_options}" if pd.notna(slug) else f"SKU_{len(sku_set)+1}"
                else:
                    variant_sku = f"{slug}_variant" if pd.notna(slug) else f"SKU_{len(sku_set)+1}"
            else:
                variant_sku = str(variant_sku).strip()

            # Ensure SKU uniqueness
            original_variant_sku = variant_sku
            counter = 1
            while variant_sku in sku_set:
                variant_sku = f"{original_variant_sku}_{counter}"
                counter += 1
            sku_set.add(variant_sku)
            variant_info['sku'] = variant_sku

            # For variants, ensure main product fields are empty
            if not is_main_product:
                variant_info['name'] = ''
                variant_info['slug'] = ''
                variant_info['description'] = ''
                variant_info['assets'] = ''
                variant_info['facets'] = ''
                variant_info['optionGroups'] = ''

            # Append variant to converted_data
            converted_data.append(variant_info)

    # Create a DataFrame from the converted data
    df = pd.DataFrame(converted_data, columns=output_columns)

    # Replace True/False with 'true'/'false' and handle 'nan' as empty strings
    df = df.replace({True:'true', False:'false', 'nan':''}, regex=True)

    try:
        # Save the DataFrame to a CSV file
        df.to_csv(output_file, index=False)
        logging.info(f"File successfully saved to '{output_file}'.")
    except Exception as e:
        logging.error(f"Error saving output file: {e}")
        sys.exit(1)
