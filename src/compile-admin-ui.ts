import 'dotenv/config';
import { compileUiExtensions } from '@vendure/ui-devkit/compiler';
import * as path from 'path';
import { MultivendorPlugin } from './plugins/multivendor-plugin/multivendor.plugin';

compileUiExtensions({
    outputPath: path.join(__dirname, '../admin-ui'),
    extensions: [
        MultivendorPlugin.ui,
    ],
})
    .compile?.()
    .then(() => {
        process.exit(0);
    });