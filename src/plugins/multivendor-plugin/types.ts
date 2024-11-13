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

export interface Seller {
    id: string;
    createdAt: string;
    updatedAt: string;
    name: string;
    deletedAt?: Date | null;
    customFields?: {
        firstName?: string;
        [key: string]: any;
    };
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
