# Service Location Endpoint Documentation

## Overview

This document describes the new GraphQL endpoint for retrieving service location information during checkout. The endpoint allows the frontend to display information about which service dealer will be used for a product, whether a service agent is available, and the scenario description.

## Endpoint Details

### GraphQL Query

```graphql
query GetServiceLocationForProduct($productId: String!) {
  getServiceLocationForProduct(productId: $productId) {
    serviceDealer {
      sellerId
      name
      firstName
      lastName
      emailAddress
      address
      postalCode
      country
      vendorType
      slug
      channel
      locales
      nationalLocale
    }
    serviceAgentAvailable
    scenario
  }
}
```

### Parameters

- `productId` (String, required): The ID of the product variant for which to retrieve service location information.

### Response

The query returns a `ServiceLocationResult` object with the following fields:

- `serviceDealer` (VendorSelectionResult, nullable): Information about the service dealer that will be used for the product. This field is null if no service dealer is available.
- `serviceAgentAvailable` (Boolean): Whether a service agent is available for the product.
- `scenario` (String): A description of the scenario that applies to the product, which explains how the service will be handled.

## Scenarios

The endpoint determines the service location based on the vendor type and other factors. The following scenarios are possible:

1. **Physical Store**: For products ordered from a physical store, the store itself is the service dealer.
   - Scenario: "Product besteld bij een WINKEL"
   - Service Agent: No

2. **Manufacturer with Service Agent and Dealer**: For products ordered from a manufacturer with a service agent and a dealer that sells the brand.
   - Scenario: "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk al verkoopt"
   - Service Agent: Yes
   - Service Dealer: First merkDealer

3. **Manufacturer without Service Agent but with Dealer**: For products ordered from a manufacturer without a service agent but with a dealer that sells the brand.
   - Scenario: "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk al verkoopt"
   - Service Agent: No
   - Service Dealer: First merkDealer

4. **Manufacturer with Service Agent and Distributor**: For products ordered from a manufacturer with a service agent and a distributor that doesn't sell the brand.
   - Scenario: "Product besteld bij een MERK met SERVICE_AGENT, service door dealer die merk nog niet verkoopt"
   - Service Agent: Yes
   - Service Dealer: merkDistributeur

5. **Manufacturer without Service Agent but with Distributor**: For products ordered from a manufacturer without a service agent but with a distributor that doesn't sell the brand.
   - Scenario: "Product besteld bij een MERK zonder SERVICE_AGENT, service door dealer die merk nog niet verkoopt"
   - Service Agent: No
   - Service Dealer: merkDistributeur

6. **Manufacturer with Service Agent but without Dealer**: For products ordered from a manufacturer with a service agent but without a dealer.
   - Scenario: "Product besteld bij een MERK met SERVICE_AGENT, maar geen beschikbare SERVICE_DEALER"
   - Service Agent: Yes
   - Service Dealer: null

7. **Manufacturer without Service Agent and without Dealer**: For products ordered from a manufacturer without a service agent and without a dealer.
   - Scenario: "Product besteld bij een MERK zonder beschikbare SERVICE_DEALER"
   - Service Agent: No
   - Service Dealer: null

8. **Boardrush Platform**: For products ordered from the Boardrush platform itself.
   - Scenario: "Product besteld bij BOARDRUSH zelf"
   - Service Agent: No
   - Service Dealer: null

9. **Boardrush Platform with Dealer that Sells the Brand**: For products ordered from the Boardrush platform with a dealer that sells the brand.
   - Scenario: "Product besteld bij BOARDRUSH zelf, service door dealer die merk bevat"
   - Service Agent: No
   - Service Dealer: First merkDealer

10. **Boardrush Platform with Dealer that Doesn't Sell the Brand**: For products ordered from the Boardrush platform with a dealer that doesn't sell the brand.
    - Scenario: "Product besteld bij BOARDRUSH zelf, service door dealer die merk niet bevat"
    - Service Agent: No
    - Service Dealer: merkDistributeur

## Usage Example

```typescript
import { gql, useQuery } from '@apollo/client';

const GET_SERVICE_LOCATION = gql`
  query GetServiceLocationForProduct($productId: String!) {
    getServiceLocationForProduct(productId: $productId) {
      serviceDealer {
        sellerId
        name
        address
        postalCode
        country
      }
      serviceAgentAvailable
      scenario
    }
  }
`;

function ServiceLocationInfo({ productId }) {
  const { loading, error, data } = useQuery(GET_SERVICE_LOCATION, {
    variables: { productId },
  });

  if (loading) return <p>Loading service location information...</p>;
  if (error) return <p>Error loading service location information: {error.message}</p>;
  if (!data?.getServiceLocationForProduct) return <p>No service location information available</p>;

  const { serviceDealer, serviceAgentAvailable, scenario } = data.getServiceLocationForProduct;

  return (
    <div>
      <h3>Service Information</h3>
      <p><strong>Scenario:</strong> {scenario}</p>
      {serviceDealer ? (
        <div>
          <p><strong>Service Dealer:</strong> {serviceDealer.name}</p>
          <p><strong>Address:</strong> {serviceDealer.address}</p>
          <p><strong>Postal Code:</strong> {serviceDealer.postalCode}</p>
          <p><strong>Country:</strong> {serviceDealer.country}</p>
        </div>
      ) : (
        <p>No service dealer available for this product.</p>
      )}
      <p><strong>Service Agent Available:</strong> {serviceAgentAvailable ? 'Yes' : 'No'}</p>
    </div>
  );
}
```

## Implementation Details

The endpoint is implemented in the `VendorSelectionResolver` class, which uses the `VendorSelectionService` to determine the appropriate vendor for a product. The service location determination logic is based on the same logic used in the `MultivendorSellerStrategy` class, ensuring consistency between the frontend and backend.

The implementation can be found in:
- `src/plugins/multivendor-plugin/api/vendor-selection.resolver.ts`
- `src/plugins/multivendor-plugin/api/api-extensions.ts`

Tests for the endpoint can be found in:
- `src/plugins/multivendor-plugin/api/vendor-selection.resolver.spec.ts`