# Commission Scenarios Documentation

This document outlines the various commission scenarios implemented in the Boardrush multivendor platform. Each scenario describes a different ordering situation and the corresponding commission distribution.

## Scenario Overview

| # | Scenario | Primary Vendor | Service Dealer | Service Agent | Boardrush Fee | Service Dealer Fee | Vendor Fee |
|---|----------|---------------|----------------|---------------|---------------|-------------------|------------|
| 1 | Product ordered from a WINKEL | PHYSICAL_STORE | Same as primary | No | 14% | - | 86% |
| 2 | Product ordered from MERK without SERVICE_AGENT (dealer sells the brand) | MANUFACTURER | Dealer selling the brand | No | 23% | 10% | 67% |
| 3 | Product ordered from MERK with SERVICE_AGENT (dealer sells the brand) | MANUFACTURER | Dealer selling the brand | Yes | 18% | 10% | 72% |
| 4 | Product ordered from MERK without SERVICE_AGENT (dealer doesn't sell the brand) | MANUFACTURER | Dealer not selling the brand | No | 23% | 7% | 70% |
| 5 | Product ordered from MERK with SERVICE_AGENT (dealer doesn't sell the brand) | MANUFACTURER | Dealer not selling the brand | Yes | 18% | 7% | 75% |
| 6 | Product ordered from BOARDRUSH itself (without service) | BOARDRUSH_PLATFORM | None | No | 100% | - | - |
| 7 | Product ordered from BOARDRUSH, service by dealer (dealer doesn't sell the brand) | BOARDRUSH_PLATFORM | Dealer not selling the brand | No | 93% | 7% | - |
| 8 | Product ordered from BOARDRUSH, service by dealer (dealer sells the brand) | BOARDRUSH_PLATFORM | Dealer selling the brand | No | 90% | 10% | - |
| 9 | Product ordered from MERK without available SERVICE_DEALER | MANUFACTURER | None | No | 23% | - | 77% |
| 10 | Product ordered from MERK with SERVICE_AGENT but without available SERVICE_DEALER | MANUFACTURER | None | Yes | 18% | - | 82% |

## Implementation Details

The commission scenarios are implemented in the `MultivendorSellerStrategy` class, specifically in the `applyCustomOrderFields` and `applyDynamicFees` methods.

### Scenario Determination Logic

The scenario is determined based on the following factors:
1. The vendor type (PHYSICAL_STORE_OR_SERVICE_DEALER, MANUFACTURER, BOARDRUSH_PLATFORM)
2. Whether a service dealer is available (merkDealers or merkDistributeur)
3. Whether the service dealer sells the brand (merkDealers)
4. Whether a service agent is available (serviceAgentAvailable)

### Commission Calculation

The commission percentages are applied to the order total and distributed as follows:
- Boardrush Fee: Retained by the platform
- Service Dealer Fee: Paid to the service dealer (if applicable)
- Vendor Fee: Paid to the primary vendor (manufacturer or physical store)

## Code References

The main implementation can be found in:
- `src/plugins/multivendor-plugin/config/mv-order-seller-strategy.ts`

Key methods:
- `applyCustomOrderFields`: Sets the scenario and service dealer based on the vendor type
- `applyDynamicFees`: Calculates the commission percentages based on the scenario

## Testing

To verify these scenarios, you can:
1. Create orders with different vendor types and service dealer configurations
2. Check the resulting scenario in the order's custom fields
3. Verify that the commission percentages match the expected values

## Notes

- For MANUFACTURER vendors, serviceAgentAvailable is set to true by default
- For BOARDRUSH_PLATFORM vendors, serviceAgentAvailable is not applicable
- The service dealer is determined based on merkDealers (if available) or merkDistributeur