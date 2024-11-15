import { bootstrap, VendureConfig } from '@vendure/core';
import { DataSource, Entity, PrimaryColumn, Column, QueryRunner } from 'typeorm';
import path from 'path';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

/**
 * @description
 * This entity tracks the seeding status, including the name of the CSV file used, the timestamp of the last seeding, and the version.
 */
@Entity()
class SeedStatus {
    @PrimaryColumn()
    id: number;

    @Column()
    csvName: string;

    @Column({ type: 'timestamp' })
    timestamp: Date;

    @Column({ nullable: true })
    version: string;
}

/**
 * @description
 * This function populates the DB with test data on the first run or if the CSV file or version has changed.
 */
export async function populateOnFirstRun(
    config: VendureConfig,
    options?: {
        csvPath?: string;
        initialDataPath?: string;
        version?: string;
        seedProducts?: boolean;
    }
) {
    if (process.env.NODE_ENV === 'production') {
        console.log('Seeding is disabled in production.');
        return;
    }

    const dataSource = new DataSource({
        ...config.dbConnectionOptions,
        entities: [SeedStatus],
        synchronize: true,
    });

    await dataSource.initialize();
    const seedRepository = dataSource.getRepository(SeedStatus);

    const currentCsvPath = options?.csvPath || path.resolve(__dirname, 'assets/products.csv');
    const currentInitialDataPath = options?.initialDataPath || path.resolve(__dirname, 'assets/initial-data.json');
    const currentCsvName = path.basename(currentCsvPath);

    const seedRecord = await seedRepository.findOne({ where: { id: 1 } });
    if (seedRecord && seedRecord.csvName === currentCsvName && seedRecord.version === options?.version) {
        console.log(`Database already seeded with CSV (${currentCsvName}) and version ${options?.version} on ${seedRecord.timestamp}. Skipping population.`);
        await dataSource.destroy();
        return;
    }

    console.log(`No matching seed record found or CSV/version has changed. Starting database population...`);

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.startTransaction();
    try {
        const app = await bootstrap(config);

        // Populate initial data from JSON file
        await loadInitialDataFromFile(app, currentInitialDataPath);

        // Conditional product seeding
        if (options?.seedProducts !== false) {
            await loadProductsFromCsv(app, currentCsvPath);
        }

        await queryRunner.commitTransaction();

        const newSeedRecord = seedRecord || new SeedStatus();
        newSeedRecord.id = 1;
        newSeedRecord.csvName = currentCsvName;
        newSeedRecord.version = options?.version || '1.0';
        newSeedRecord.timestamp = new Date();
        await seedRepository.save(newSeedRecord);

        console.log(`Seeding completed successfully.`);
        await app.close();
    } catch (error) {
        console.error('Seeding failed. Rolling back changes:', error);
        await queryRunner.rollbackTransaction();
    } finally {
        await queryRunner.release();
        await dataSource.destroy();
    }
}

/**
 * @description
 * Loads initial data from a JSON file and populates the database.
 */
async function loadInitialDataFromFile(app: any, filePath: string) {
    const initialData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Insert logic here to use `initialData` to populate Vendure entities (categories, products, etc.)
    console.log(`Loaded initial data from ${filePath}`);
}

/**
 * @description
 * Parses and imports products from a CSV file into Vendure.
 */
async function loadProductsFromCsv(app: any, csvFilePath: string) {
    const csvContent = fs.readFileSync(csvFilePath, 'utf-8');
    const records = parse(csvContent, { columns: true });

    // Insert logic here to map CSV records to Vendure Product entities
    for (const record of records) {
        // Example: Create a Vendure product based on the CSV record
        console.log(`Importing product: ${record.name}`);
    }
}

/**
 * @description
 * Checks if there are any existing tables in the database.
 */
async function tablesExist(config: VendureConfig): Promise<boolean> {
    const dataSource = new DataSource(config.dbConnectionOptions);
    await dataSource.initialize();
    try {
        const result = await dataSource.query(`
            SELECT n.nspname as table_schema,
                   c.relname as table_name,
                   c.reltuples as rows
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r'
              AND n.nspname = '${process.env.DB_SCHEMA}'
            ORDER BY c.reltuples DESC;`
        );
        return result.length > 0;
    } finally {
        await dataSource.destroy();
    }
}
