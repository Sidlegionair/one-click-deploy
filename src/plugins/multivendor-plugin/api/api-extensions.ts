import gql from 'graphql-tag';

export const shopApiExtensions = gql`
    type VendorSelectionResult {
        sellerId: ID!
        name: String!
        firstName: String!
        lastName: String!
        emailAddress: String!
        address: String!
        postalCode: String!
        country: String!
        vendorType: String!
        slug: String!
        channel: String!
        locales: [String!]!
        nationalLocale: String!
    }

    type ServiceLocationResult {
        serviceDealer: VendorSelectionResult
        serviceAgentAvailable: Boolean!
        scenario: String!
    }

    input CreateSellerInput {
        firstName: String!
        lastName: String!
        emailAddress: String!
        password: String!
    }

    input RegisterSellerInput {
        shopName: String!
        seller: CreateSellerInput!
    }

    extend input UpdateCustomerInput {
        emailAddress: String
    }

    extend type Mutation {
        registerNewSeller(input: RegisterSellerInput!): Channel
    }

    extend type Query {
        selectVendorForVariation(productId: String!): VendorSelectionResult
        getServiceLocationForProduct(productId: String!): ServiceLocationResult
    }
`;
