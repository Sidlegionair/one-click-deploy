import React, { useEffect, useState, useRef } from 'react';
import { gql } from '@apollo/client';
import { useLazyQuery } from '@vendure/admin-ui/react';
import { Seller } from '@vendure/admin-ui/core';

interface MultipleSellerInputProps {
    readonly: boolean;
    config?: any;
    formControl: {
        // for a list:true relation field, value is Seller[] | null
        value: Seller[] | null;
        setValue: (val: Seller[] | null) => void;
        markAsDirty: () => void;
    };
}

interface GetSellersResponse {
    sellers: {
        items: Seller[];
    };
}

const GET_SELLERS = gql`
  query GetSellers($options: SellerListOptions) {
    sellers(options: $options) {
      items {
        id
        name
      }
    }
  }
`;

const MultipleSellerInput: React.FC<MultipleSellerInputProps> = ({
                                                                     readonly,
                                                                     formControl,
                                                                 }) => {
    const [allSellers, setAllSellers] = useState<Seller[]>([]);
    // Local state for the select’s value
    const [selectedIds, setSelectedIds] = useState<string[]>(
        () => formControl.value?.map(s => s.id) ?? []
    );

    // Vendure’s lazyQuery hook
    const [load, { data, loading, error }] = useLazyQuery<GetSellersResponse>(
        GET_SELLERS,
        { refetchOnChannelChange: true }
    );

    // Fetch once on mount
    const fetched = useRef(false);
    useEffect(() => {
        if (!fetched.current) {
            load({
                variables: { options: { take: 200 } },
                fetchPolicy: 'network-only',
            });
            fetched.current = true;
        }
    }, [load]);

    // Store the results
    useEffect(() => {
        if (data?.sellers?.items) {
            setAllSellers(data.sellers.items);
        }
    }, [data]);

    // If Vendure resets the formControl.value (e.g. form reset), sync local
    useEffect(() => {
        setSelectedIds(formControl.value?.map(s => s.id) ?? []);
    }, [formControl.value]);

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const ids = Array.from(e.target.selectedOptions).map(o => o.value);
        setSelectedIds(ids);
        // Turn the ids back into Seller[] and push into Vendure
        const next = allSellers.filter(s => ids.includes(s.id));
        formControl.setValue(next.length ? next : null);
        formControl.markAsDirty();
    };

    if (loading) return <p>Loading sellers…</p>;
    if (error) return <p>Error loading sellers: {error}</p>;

    return (
        <div>
            <h4>Choose MERK Dealers:</h4>
            <select
                multiple
                disabled={readonly}
                value={selectedIds}
                onChange={handleChange}
                style={{ width: '100%', minHeight: '8em' }}
            >
                {allSellers.map(s => (
                    <option key={s.id} value={s.id}>
                        {s.name}
                    </option>
                ))}
            </select>
            {selectedIds.length > 0 && (
                <p style={{ marginTop: '0.5em' }}>
                    Selected: {allSellers.filter(s => selectedIds.includes(s.id)).map(s => s.name).join(', ')}
                </p>
            )}
        </div>
    );
};

export default MultipleSellerInput;
