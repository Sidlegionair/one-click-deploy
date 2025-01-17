import {
    bootstrap,
    VendureConfig,
    AssetService,
    RequestContext,
    ChannelService,
} from '@vendure/core';
import { DataSource } from 'typeorm';
import path from 'path';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { ReadStream } from 'fs';
import { populate } from '@vendure/core/cli';

/**
 * Populates the DB with initial data if it hasn’t been populated before.
 */
export async function populateOnFirstRun(config: VendureConfig) {
    let tempCsvPath = '';
    const debugMode = true; // Set this to `false` to delete temp CSV on success

    try {
        const csvPath = path.resolve('./seed/products_fixed.csv');
        console.error(`[INFO] Checking for CSV file at path: ${csvPath}`);

        if (!fs.existsSync(csvPath)) {
            console.error(`[ERROR] CSV file not found at path: ${csvPath}`);
            throw new Error(`CSV file not found. Ensure the file exists and the path is correct.`);
        }

        const alreadyPopulated = await isAlreadyPopulated(config);
        if (!alreadyPopulated) {
            console.error(`[INFO] Vendure tables not found in DB. Populating database...`);

            const assetsDir = path.resolve('./seed/images');
            console.error(`[INFO] Assets directory resolved to: ${assetsDir}`);

            // Single bootstrap call
            const app = await bootstrap({
                ...config,
                importExportOptions: {
                    importAssetsDir: assetsDir,
                },
                dbConnectionOptions: {
                    ...config.dbConnectionOptions,
                    synchronize: true,
                },
            });

            try {
                const assetService = app.get(AssetService);
                const channelService = app.get(ChannelService);

                // Get the default channel using ChannelService
                console.error(`[INFO] Fetching the default channel...`);
                const defaultChannel = await channelService.getDefaultChannel();
                console.error(`[INFO] Default channel retrieved: ${defaultChannel.code}`);

                // Create a RequestContext
                const ctx = new RequestContext({
                    apiType: 'admin',
                    channel: defaultChannel,
                    isAuthorized: true,
                    authorizedAsOwnerOnly: false,
                    session: undefined,
                    req: undefined,
                    languageCode: defaultChannel.defaultLanguageCode,
                });

                const csvContent = fs.readFileSync(csvPath, 'utf-8');
                console.error(`[INFO] Parsing CSV content...`);

                const records: Record<string, string>[] = parse(csvContent, {
                    columns: true,
                    skip_empty_lines: true,
                    trim: true,
                });

                // Upload assets and get the mapping
                const assetMappings = await uploadAssets(assetService, ctx, assetsDir, records);

                console.error(`[INFO] Replacing asset paths with IDs in CSV...`);
                tempCsvPath = generateTempCsvWithAssetIds(csvPath, assetMappings);

                console.error(`[INFO] Temporary CSV generated at: ${tempCsvPath}`);

                // Import products using the modified CSV
                console.error(`[INFO] Starting products import...`);
                await importProducts(app, tempCsvPath, config, assetsDir);

                console.error(`[INFO] Products imported successfully.`);

                // Cleanup temporary CSV based on debug mode
                if (!debugMode && tempCsvPath) {
                    fs.unlinkSync(tempCsvPath);
                    console.error(`[INFO] Temporary CSV file deleted.`);
                } else {
                    console.error(`[DEBUG] Debug mode enabled. Temporary CSV retained for review: ${tempCsvPath}`);
                }

                // Mark as populated
                await markAsPopulated(config);
            } finally {
                await app.close();
            }
        } else {
            console.error(`[INFO] Vendure tables already exist. Skipping population.`);
        }
    } catch (error) {
        console.error(`[ERROR] Failed to populate database on first run:`, (error as Error).message);
        if (tempCsvPath) {
            console.error(`[INFO] Temporary CSV retained at: ${tempCsvPath}`);
        }
        throw error;
    }
}

/**
 * Uploads assets to Vendure and maps file paths to asset IDs.
 */
async function uploadAssets(
    assetService: AssetService,
    ctx: RequestContext,
    assetsDir: string,
    records: Record<string, string>[]
): Promise<Record<string, string>> {
    const assetMapping: Record<string, string> = {};

    for (const record of records) {
        const filePaths = [
            record['variant:frontPhoto'],
            record['variant:backPhoto'],
        ].filter(Boolean);

        for (const filePath of filePaths) {
            const sanitizedPath = sanitizeFilePath(filePath);
            const fullPath = path.join(assetsDir, sanitizedPath);

            if (!fs.existsSync(fullPath)) {
                console.error(`[WARN] Asset file not found: ${fullPath}. Skipping.`);
                continue;
            }

            const fileStream: ReadStream = fs.createReadStream(fullPath);

            try {
                const asset = await assetService.createFromFileStream(fileStream, ctx);
                if ('id' in asset) {
                    assetMapping[sanitizedPath] = String(asset.id);
                    console.error(`[INFO] Uploaded asset "${sanitizedPath}" with ID "${asset.id}".`);
                } else {
                    console.error(`[WARN] Failed to upload asset "${sanitizedPath}":`, asset);
                }
            } catch (error) {
                console.error(`[ERROR] Failed to upload asset "${sanitizedPath}":`, (error as Error).message);
            }
        }
    }

    return assetMapping;
}

/**
 * Generates a temporary CSV with asset IDs replacing file paths.
 */
function generateTempCsvWithAssetIds(
    originalCsvPath: string,
    assetMapping: Record<string, string>
): string {
    const csvContent = fs.readFileSync(originalCsvPath, 'utf-8');
    const tempCsvPath = path.resolve('./seed/temp_products_fixed.csv');

    const records: Record<string, string>[] = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
    });

    const updatedRecords = records.map(record => {
        if (record['variant:frontPhoto']) {
            record['variant:frontPhoto'] =
                assetMapping[sanitizeFilePath(record['variant:frontPhoto'])] || '';
        }
        if (record['variant:backPhoto']) {
            record['variant:backPhoto'] =
                assetMapping[sanitizeFilePath(record['variant:backPhoto'])] || '';
        }
        return record;
    });

    const updatedCsvContent = stringify(updatedRecords, { header: true });
    fs.writeFileSync(tempCsvPath, updatedCsvContent, 'utf-8');

    console.error(`[INFO] Temporary CSV saved at: ${tempCsvPath}`);
    return tempCsvPath;
}

/**
 * Imports products from the temporary CSV using the existing app instance.
 */
async function importProducts(
    app: any,
    tempCsvPath: string,
    config: VendureConfig,
    assetsDir: string
) {
    // Ensure the temporary CSV exists
    if (!fs.existsSync(tempCsvPath)) {
        throw new Error(`Temporary CSV file not found at path: ${tempCsvPath}`);
    }

    // Assuming that Vendure's populate function can be used here
    // Adjust the path to initial-data.json as per your project structure
    const initialDataPath = path.resolve('./seed/initial-data.json');

    if (!fs.existsSync(initialDataPath)) {
        throw new Error(`Initial data JSON not found at path: ${initialDataPath}`);
    }

    // Execute the populate function to import products using the existing app instance
    await populate(
        async () => app, // Use the existing app instance
        require(initialDataPath),
        tempCsvPath
    )
        .then(() => {
            console.log(`[Populate Debug] Finished populating products.`);
        })
        .catch(error => {
            console.error(`[Populate Debug] Population failed:`, error);
            throw error;
        });
}

/**
 * Sanitizes a file path by removing unwanted characters and normalizing.
 */
function sanitizeFilePath(filePath: string): string {
    return filePath.replace(/\)$/, '').trim();
}

/**
 * Checks if the database has already been populated.
 */
async function isAlreadyPopulated(config: VendureConfig): Promise<boolean> {
    const dataSource = new DataSource({
        ...config.dbConnectionOptions,
        entities: [],
        synchronize: false,
    });
    await dataSource.initialize();
    try {
        const result = await dataSource.query(`
            SELECT 1 FROM information_schema.tables WHERE table_name = 'custom_migration_status';
        `);
        return result.length > 0;
    } finally {
        await dataSource.destroy();
    }
}

async function markAsPopulated(config: VendureConfig) {
    const dataSource = new DataSource({
        ...config.dbConnectionOptions,
        entities: [],
        synchronize: false,
    });

    await dataSource.initialize();
    try {
        // Create the table with a UNIQUE constraint on migration_name
        await dataSource.query(`
            CREATE TABLE IF NOT EXISTS custom_migration_status (
                                                                   id SERIAL PRIMARY KEY,
                                                                   migration_name VARCHAR(255) NOT NULL UNIQUE
                );
        `);

        // Insert the migration_name, avoiding duplicates
        await dataSource.query(`
            INSERT INTO custom_migration_status (migration_name)
            VALUES ('initial-seed')
                ON CONFLICT (migration_name) DO NOTHING;
        `);
    } finally {
        await dataSource.destroy();
    }
}
