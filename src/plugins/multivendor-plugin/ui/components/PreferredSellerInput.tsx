import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { gql } from '@apollo/client';
import { useLazyQuery } from '@vendure/admin-ui/react';
import { Seller } from '@vendure/admin-ui/core';

interface PreferredSellerInputProps {
    readonly: boolean;
    config?: any;
    formControl: {
        value: Seller | null;
        setValue: (value: Seller | null) => void;
        markAsDirty: () => void; // Added this to indicate form change
    };
}

interface GetSellersResponse {
    sellers: {
        items: Seller[];
        totalItems: number;
    };
}

const GET_SELLERS = gql`
  query GetSellers($options: SellerListOptions) {
    sellers(options: $options) {
      items {
        id
        name
        createdAt
        updatedAt
        customFields {
          firstName
        }
      }
      totalItems
    }
  }
`;

const PreferredSellerInput: React.FC<PreferredSellerInputProps> = ({ readonly, formControl }) => {
    const [sellers, setSellers] = useState<Seller[]>([]);
    const [selectedSellerId, setSelectedSellerId] = useState<string>(formControl.value?.id || '');

    const [fetchSellersLazy, { data, loading, error }] = useLazyQuery<GetSellersResponse>(GET_SELLERS, {
        refetchOnChannelChange: true,
    });

    const fetchSellers = useCallback(() => {
        fetchSellersLazy({ variables: { options: { take: 10 } } });
    }, [fetchSellersLazy]);

    useEffect(() => {
        if (sellers.length === 0) {
            fetchSellers();
        }
    }, [fetchSellers, sellers.length]);

    useEffect(() => {
        if (data?.sellers?.items) {
            const activeSellers = data.sellers.items;
            setSellers(activeSellers);
            if (formControl.value && !selectedSellerId) {
                setSelectedSellerId(formControl.value.id);
            }
        }
    }, [data, formControl.value, selectedSellerId]);

    const handleChange = useCallback(
        (event: React.ChangeEvent<HTMLSelectElement>) => {
            const selectedId = event.target.value;
            const selectedSeller = sellers.find((seller) => seller.id === selectedId) || null;
            setSelectedSellerId(selectedId);
            formControl.setValue(selectedSeller);
            formControl.markAsDirty(); // Mark the form as dirty to enable save/update button
        },
        [sellers, formControl]
    );

    const selectedSeller = useMemo(
        () => sellers.find((seller) => seller.id === selectedSellerId) || null,
        [selectedSellerId, sellers]
    );

    if (loading) return <p>Loading sellers...</p>;
    if (error) return <p>Error: {typeof error === 'object' && 'message' in error ? (error as any).message : 'An error occurred'}</p>;

    return (
        <div>
            {selectedSeller && (
                <div>
                    <span>{selectedSeller.name}</span>
                    <button onClick={() => console.log(`Link to seller details for seller: ${selectedSellerId}`)}>
                        <i className="fas fa-link"></i>
                    </button>
                </div>
            )}
            <div>
                <select
                    value={selectedSellerId || ''}
                    onChange={handleChange}
                    disabled={readonly}
                    aria-label="Select a seller"
                >
                    <option value="">Select a seller...</option>
                    {sellers.map(({ id, name }) => (
                        <option key={id} value={id}>
                            {name}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
};

export default PreferredSellerInput;
