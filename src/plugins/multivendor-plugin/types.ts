import {CustomOrderLineFields, Seller} from '@vendure/core';


export interface MultivendorPluginOptions {
    platformFeePercent: number;
    platformFeeSKU: string;
}

export interface CreateSellerInput {
    firstName: string;
    lastName: string;
    emailAddress: string;
    password: string;
}

// export interface Seller {
//     id: string;
//     createdAt: string;
//     updatedAt: string;
//     name: string;
//     deletedAt?: Date | null;
//     customFields?: {
//         firstName?: string;
//         [key: string]: any;
//     };
// }
//
//

// Use Vendure's Seller type for our custom fields.
declare module '@vendure/core' {
    interface CustomSellerFields {
        connectedAccountId: string;
        shopName?: string;
        firstName?: string;
        lastName?: string;
        emailAddress?: string;
        password?: string;
        address?: string;
        postalCode?: string;
        country?: string;
        vendorType?: string;
        merkDealer?: Seller | null;
        merkDistributeur?: Seller | null;
    }
}


declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        transactionId?: string;
        scenario?: string;
        primaryVendor?: Seller | null;
        serviceDealer?: Seller | null;
        serviceAgentAvailable?: boolean;
    }
}

declare module '@vendure/core' {
    interface CustomOrderLineFields {
        requestedSellerChannel?: string;
    }
}

export interface GetSellersResponse {
    sellers: {
        items: Seller[];
        totalItems: number;
    };
}

export interface PreferredSellerInputProps {
    readonly: boolean;
    config?: any;
    formControl: {
        value: Seller | null;
        setValue: (value: Seller | null) => void;
    };
}
