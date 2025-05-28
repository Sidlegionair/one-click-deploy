# Vendor Selection Algorithm Documentation

## Overview

This document describes the vendor selection algorithm implemented in the `VendorSelectionService` class. The algorithm selects the best vendor for a customer's order based on a hierarchical set of criteria.

## Algorithm Steps

The algorithm follows these steps in order:

1. **Filter Available Vendors**
   - Only consider vendors that have the product in stock
   - If no customer is authenticated, only consider vendors that support the current language

2. **Apply Hierarchical Selection Criteria**
   1. **Customer's Preferred Shop (Voorkeurswinkel van de klant)**
      - If the customer has a preferred shop selected, use that vendor
   
   2. **Lowest Price Domestic (Prijs binnen landsgrenzen)**
      - Find physical stores or service dealers in the customer's country
      - Select the one with the lowest price
   
   3. **Selection Based on Postal Code (Selectie op Basis van Postcode)**
      - Find physical stores or service dealers in the customer's country
      - Select the one closest to the customer's postal code
   
   4. **BOARDRUSH Stock (BOARDRUSH Voorraad)**
      - If BOARDRUSH has the product in stock, use BOARDRUSH as the vendor
   
   5. **MERK Distributor in Country (MERK Distributeur in Land)**
      - Find manufacturers or agents in the customer's country
      - First try manufacturers with merkDealers
      - Then try manufacturers with merkDistributeur
      - Then try any agent
   
   6. **MERK Factory (MERK Fabriek)**
      - If a manufacturer has the product in stock, use that manufacturer
   
   7. **International Selection Based on Postal Code (Internationale Selectie op Basis van Postcode)**
      - If no suitable vendor is found within the country, find the international vendor closest to the customer's postal code

## Implementation Details

The algorithm is implemented in the `selectVendorForVariation` method of the `VendorSelectionService` class. The method takes a `RequestContext` and a `productId` as parameters and returns a `Vendor` object.

```typescript
async selectVendorForVariation(ctx: RequestContext, productId: string): Promise<Vendor>
```

### Key Components

1. **getVendors**: Retrieves all vendors that sell the specified product
2. **getAuthenticatedCustomer**: Gets the authenticated customer, if any
3. **resolveCustomerLocation**: Determines the customer's location (postal code and country)
4. **getClosestVendor**: Finds the vendor closest to the customer's location
5. **haversineDistance**: Calculates the distance between two geographical points

## Integration

This algorithm is used in the following places:

1. **Frontend**: To display the selected vendor for a product
2. **Backend**: In the `MultivendorSellerStrategy` to determine the seller channel for an order line

## Example

For a customer in the Netherlands (NL) with postal code 1012JS:

1. If the customer has a preferred shop, that shop will be selected
2. If not, the physical store in the Netherlands with the lowest price will be selected
3. If no physical store in the Netherlands has the product, the closest physical store to the customer's postal code will be selected
4. If no physical store has the product, BOARDRUSH will be selected if it has the product in stock
5. If BOARDRUSH doesn't have the product, a manufacturer or agent in the Netherlands will be selected
6. If no manufacturer or agent in the Netherlands has the product, any manufacturer will be selected
7. If no manufacturer has the product, the international vendor closest to the customer's postal code will be selected