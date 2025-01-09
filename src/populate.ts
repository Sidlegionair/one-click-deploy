import { populate } from '@vendure/core/cli';
import { bootstrap, VendureConfig } from '@vendure/core';
import { DataSource } from 'typeorm';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import os from 'os';

/**
 * @description
 * Populates the DB with initial data if it hasn’t been populated before.
 * Uses a migration table as a flag to ensure it only runs once.
 */
export async function populateOnFirstRun(config: VendureConfig) {
    try {
        const csvPath = path.resolve('./seed/products_fixed.csv');
        console.log(`Checking for CSV file at path: ${csvPath}`);

        if (!fs.existsSync(csvPath)) {
            console.error(`CSV file not found at path: ${csvPath}`);
            throw new Error(`CSV file not found. Ensure the file exists and the path is correct.`);
        } else {
            console.log(`CSV file found at path: ${csvPath}`);
        }

        const alreadyPopulated = await isAlreadyPopulated(config);
        if (!alreadyPopulated) {
            console.log(`No Vendure tables found in DB. Populating database...`);

            const assetsDir = path.join(csvPath, '../images');
            console.log(`Assets directory resolved to: ${assetsDir}`);

            let assetMapping: Record<string, string> = {};
            if (fs.existsSync(assetsDir)) {
                console.log(`Uploading assets from directory: ${assetsDir}`);
                assetMapping = await uploadAssets(assetsDir, config);
                console.log(`Asset upload completed. Mapping:`, assetMapping);

                console.log(`Generating temporary CSV with uploaded asset IDs...`);
                const tempCsvPath = generateTempCsv(csvPath, assetMapping);
                console.log(`Temporary CSV generated at: ${tempCsvPath}`);

                await populate(
                    () => bootstrap({
                        ...config,
                        importExportOptions: {
                            importAssetsDir: assetsDir,
                        },
                        dbConnectionOptions: {
                            ...config.dbConnectionOptions,
                            synchronize: true,
                        },
                    }),
                    require('@vendure/create/assets/initial-data.json'),
                    tempCsvPath
                )
                    .then(app => {
                        console.log(`[Populate Debug] Finished populating.`);
                        app.close();
                    })
                    .catch(error => {
                        const err = error as Error;
                        console.error(`[Populate Debug] Population failed:`, err.message);
                    });

                fs.unlinkSync(tempCsvPath); // Clean up temporary CSV
                console.log(`Temporary CSV file deleted.`);
            } else {
                console.warn(`Assets directory not found: ${assetsDir}`);
                console.log(`Proceeding without assets directory...`);
            }

            await markAsPopulated(config);
        } else {
            console.log(`Vendure tables already exist. Skipping population.`);
        }
    } catch (error) {
        const err = error as Error;
        console.error(`Failed to populate database on first run:`, err.message);
        throw err;
    }
}

async function isAlreadyPopulated(config: VendureConfig) {
    const dataSource = new DataSource({
        ...config.dbConnectionOptions,
        entities: [],
        synchronize: false,
    });
    await dataSource.initialize();
    try {
        await dataSource.query(`
            CREATE TABLE IF NOT EXISTS vendure_migrations (
                                                              id SERIAL PRIMARY KEY,
                                                              migration_name VARCHAR(255) UNIQUE NOT NULL
                );
        `);
        const result = await dataSource.query(`
            SELECT * FROM vendure_migrations WHERE migration_name = 'initial-seed';
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
        await dataSource.query(`
            INSERT INTO vendure_migrations (migration_name) VALUES ('initial-seed')
                ON CONFLICT (migration_name) DO NOTHING;
        `);
    } finally {
        await dataSource.destroy();
    }
}

async function uploadAssets(assetsDir: string, config: VendureConfig): Promise<Record<string, string>> {
    const files = fs.readdirSync(assetsDir).filter(file =>
        file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')
    );
    const assetMapping: Record<string, string> = {};
    const vendureApiUrl = `${config.apiOptions.adminApiPath || '/admin-api'}`;
    const token = process.env.ADMIN_API_TOKEN || '';

    for (const file of files) {
        const filePath = path.join(assetsDir, file);
        const formData = new FormData();
        formData.append('operations', JSON.stringify({
            query: `
                mutation($file: Upload!) {
                    createAssets(input: [{ file: $file }]) {
                        assets {
                            id
                            name
                        }
                        errors {
                            message
                        }
                    }
                }
            `,
            variables: { file: null }
        }));
        formData.append('map', JSON.stringify({ '0': ['variables.file'] }));
        formData.append('0', fs.createReadStream(filePath));

        try {
            const response = await axios.post(vendureApiUrl, formData, {
                headers: {
                    ...formData.getHeaders(),
                    Authorization: `Bearer ${token}`
                }
            });
            const assets = response.data?.data?.createAssets?.assets || [];
            if (assets.length > 0) {
                const assetId = assets[0].id;
                assetMapping[file] = assetId;
                console.log(`Uploaded asset ${file} with ID ${assetId}`);
            } else {
                console.error(`Failed to upload asset ${file}:`, response.data?.errors || 'Unknown error');
            }
        } catch (error) {
            const err = error as Error;
            console.error(`Error uploading asset ${file}:`, err.message);
        }
    }

    return assetMapping;
}

/**
 * Generates a temporary CSV file by replacing file paths with asset IDs.
 * Leaves columns blank for unresolved or invalid paths.
 */
function generateTempCsv(csvPath: string, assetMapping: Record<string, string>): string {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const tempCsvPath = path.join(os.tmpdir(), `temp_products_${Date.now()}.csv`);

    const updatedContent = csvContent.split('\n').map((line, index) => {
        let updatedLine = line;

        // Replace file paths with asset IDs or clear unresolved paths
        updatedLine = updatedLine.replace(/\S+\.(png|jpg|jpeg)/g, match => {
            return assetMapping[match] || ''; // Replace with ID or clear if not found
        });

        return updatedLine;
    }).join('\n');

    fs.writeFileSync(tempCsvPath, updatedContent, 'utf-8');
    console.log(`Temporary CSV created at: ${tempCsvPath}`);
    return tempCsvPath;
}
