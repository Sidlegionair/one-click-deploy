import { populate } from '@vendure/core/cli';
import { bootstrap, VendureConfig } from '@vendure/core';
import { DataSource } from 'typeorm';
import path from 'path';

/**
 * @description
 * Populates the DB with initial data if it hasn’t been populated before.
 * Uses a migration table as a flag to ensure it only runs once.
 */
export async function populateOnFirstRun(config: VendureConfig) {
    try {
        const alreadyPopulated = await isAlreadyPopulated(config);
        if (!alreadyPopulated) {
            console.log(`No Vendure tables found in DB. Populating database...`);
            await populate(
                () => bootstrap({
                    ...config,
                    importExportOptions: {
                        importAssetsDir: path.join(
                            require.resolve('@vendure/create/assets/products_test.csv'),
                            '../images'
                        ),
                    },
                    dbConnectionOptions: {
                        ...config.dbConnectionOptions,
                        synchronize: true, // Ensures tables are created if missing
                    },
                }),
                require('@vendure/create/assets/initial-data.json'),
                require.resolve('@vendure/create/assets/products_test.csv')
            ).then(app => app.close());

            // Mark as populated
            await markAsPopulated(config);
        } else {
            console.log(`Vendure tables already exist. Skipping population.`);
        }
    } catch (error) {
        console.error(`Failed to populate database on first run:`, error);
        throw error;
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
        // Check for vendure_migrations table and the 'initial-seed' entry
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
