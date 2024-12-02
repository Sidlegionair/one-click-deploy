import {
    LanguageCode,
    PluginCommonModule,
    VendurePlugin,
    RuntimeVendureConfig,
    ProductService,
} from '@vendure/core';

import { ProductReview } from './entities/product-review.entity';
import { adminApiExtensions, shopApiExtensions } from './api/api-extensions';
import { ProductEntityResolver } from './api/product-entity.resolver';
import { ProductReviewAdminResolver } from './api/product-review-admin.resolver';
import { ProductReviewEntityResolver } from './api/product-review-entity.resolver';
import { ProductReviewShopResolver } from './api/product-review-shop.resolver';
import path from 'path';
import { AdminUiExtension } from '@vendure/ui-devkit/compiler';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ProductReview],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [
            ProductEntityResolver,
            ProductReviewAdminResolver,
            ProductReviewEntityResolver,
        ],
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [
            ProductEntityResolver,
            ProductReviewShopResolver,
            ProductReviewEntityResolver,
        ],
    },
    configuration: (config: RuntimeVendureConfig) => {
        config.customFields.Product = [
            ...(config.customFields.Product || []),
            {
                name: 'reviewRating',
                label: [
                    { languageCode: LanguageCode.en, value: 'Review rating' },
                ],
                public: true,
                nullable: true,
                type: 'float',
                ui: {
                    tab: 'Reviews',
                    component: 'star-rating-form-input',
                },
            },
            {
                name: 'reviewCount',
                label: [
                    { languageCode: LanguageCode.en, value: 'Review count' },
                ],
                public: true,
                defaultValue: 0,
                type: 'float',
                ui: {
                    tab: 'Reviews',
                    component: 'review-count-link',
                },
            },
            {
                name: 'featuredReview',
                label: [
                    { languageCode: LanguageCode.en, value: 'Featured review' },
                ],
                public: true,
                type: 'relation',
                entity: ProductReview,
                ui: {
                    tab: 'Reviews',
                    component: 'review-selector-form-input',
                },
            },
        ];
        return config;
    },
})
export class ReviewsPlugin {
    static uiExtensions: AdminUiExtension = {
        extensionPath: path.join(__dirname, 'ui'),
        routes: [{ route: 'product-reviews', filePath: 'routes.ts' }],
        providers: ['providers.ts'],
    };
}
