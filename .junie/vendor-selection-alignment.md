# Vendor Selection Alignment

## Overview

This document describes the alignment of vendor selection logic between the frontend and backend components of the Boardrush multivendor platform. The goal is to ensure that both the `VendorSelectionService` (used for frontend selection) and the `MultivendorSellerStrategy` (used for order processing) use the same logic for selecting vendors.

## Components Involved

1. **VendorSelectionService**: Responsible for selecting the appropriate vendor for a product variant in the frontend.
2. **MultivendorSellerStrategy**: Implements the OrderSellerStrategy interface and handles the assignment of seller channels to order lines during order processing.

## Problem Statement

Previously, these two components used different logic for vendor selection:

- **VendorSelectionService** used a complex hierarchical selection algorithm based on various criteria like vendor type, stock availability, customer location, etc.
- **MultivendorSellerStrategy** simply selected the first available seller channel or a specifically requested one.

This inconsistency could lead to different vendors being selected for the same product in the frontend and during order processing, causing confusion and potential issues.

## Solution

The solution was to modify the `MultivendorSellerStrategy.setOrderLineSellerChannel` method to use the `VendorSelectionService` for vendor selection. This ensures that both components use the same logic for selecting vendors.

### Changes Made

1. Added import for VendorSelectionService to MultivendorSellerStrategy
2. Added vendorSelectionService property to MultivendorSellerStrategy
3. Initialized vendorSelectionService in the init method
4. Modified setOrderLineSellerChannel to use VendorSelectionService for vendor selection

### New Selection Logic

The new vendor selection logic in `setOrderLineSellerChannel` follows these steps:

1. Check if a specific seller channel was requested via customFields
2. Ensure the productVariant is hydrated with its channels
3. Filter out the default channel
4. If a specific seller channel was requested and it exists, use it
5. If there's only one seller channel, use it
6. Otherwise, use VendorSelectionService.selectVendorForVariation to select the best vendor
7. Find the channel that corresponds to the selected vendor
8. Fall back to the first available seller channel if no matching channel is found or if an error occurs

### Hierarchical Selection Algorithm

The hierarchical selection algorithm used by VendorSelectionService (and now by MultivendorSellerStrategy) follows these steps:

1. Get all vendors for the product
2. Filter for vendors that have the product in stock
3. If no customer is authenticated, filter for vendors that support the current language
4. Then apply a priority-based selection:
   a. BOARDRUSH_PLATFORM vendors first
   b. Customer's preferred shop if set
   c. Lowest price domestic physical store
   d. MANUFACTURER with merkDealers that are available
   e. Nearby non-attached physical stores
   f. MANUFACTURER with merkDistributeur or AGENT
   g. Any MANUFACTURER
   h. International fallback based on proximity

## Testing

A comprehensive test suite has been created to verify that the MultivendorSellerStrategy correctly uses the VendorSelectionService for vendor selection. The tests cover various scenarios:

1. No seller channels found
2. Using a requested seller channel if provided and valid
3. Using the only available seller channel if there's only one
4. Using VendorSelectionService to select the best vendor when multiple channels are available
5. Falling back to the first available channel if VendorSelectionService throws an error
6. Falling back to the first available channel if no matching channel is found for the selected vendor

## Benefits

1. **Consistency**: Both frontend and backend use the same vendor selection logic, ensuring a consistent experience.
2. **Improved User Experience**: Customers will see the same vendor selected in the frontend and in their orders.
3. **Maintainability**: Changes to the vendor selection algorithm only need to be made in one place (VendorSelectionService).
4. **Reliability**: The robust hierarchical selection algorithm ensures the best vendor is selected based on various criteria.

## Future Considerations

1. **Performance**: The hierarchical selection algorithm is more complex and may have performance implications. Monitor performance and optimize if necessary.
2. **Caching**: Consider caching vendor selection results to improve performance.
3. **Configuration**: Make the selection algorithm configurable to allow for different selection strategies in different contexts.