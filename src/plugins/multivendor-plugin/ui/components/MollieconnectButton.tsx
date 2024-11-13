import React, { useEffect, useState, useCallback } from 'react';
import { gql } from '@apollo/client';
import { useLazyQuery } from '@vendure/admin-ui/react';

// GraphQL query to get the active administrator
const GET_ACTIVE_ADMINISTRATOR = gql`
  query GetActiveAdministrator {
    activeAdministrator {
      id
      firstName
      lastName
      emailAddress
      customFields {
        mollieAccessToken
        mollieRefreshToken
        mollieConnected
      }
    }
  }
`;

// Define the TypeScript interface for the query result
interface GetActiveAdministratorResponse {
    activeAdministrator: {
        id: string;
        firstName: string;
        lastName: string;
        emailAddress: string;
        customFields: {
            mollieAccessToken: string;
            mollieRefreshToken: string;
            mollieConnected: boolean;
        };
    };
}

interface GetActiveAdministratorVars {}

const MollieConnectButton: React.FC = () => {
    const [fetchAdmin, { data, loading: adminLoading, error: adminError }] = useLazyQuery<
        GetActiveAdministratorResponse,
        GetActiveAdministratorVars
    >(GET_ACTIVE_ADMINISTRATOR);

    const [mollieConnected, setMollieConnected] = useState(false);

    // Fetch the admin info when the component mounts or when necessary
    useEffect(() => {
        if (!data) {
            fetchAdmin(); // Trigger fetching the active administrator if there is no data yet
        }
    }, [data, fetchAdmin]);

    // Update Mollie connected state based on the query response
    useEffect(() => {
        if (data?.activeAdministrator) {
            const { customFields } = data.activeAdministrator;

            // Check if both mollieAccessToken and mollieRefreshToken are present and mollieConnected is true
            const isConnected = !!customFields.mollieConnected &&
                !!customFields.mollieAccessToken &&
                !!customFields.mollieRefreshToken;

            setMollieConnected(isConnected);
        }
    }, [data]);

    const handleConnect = useCallback(() => {
        const adminId = data?.activeAdministrator?.id;

        if (!adminId) {
            console.error('No administrator ID found for the current user.');
            return;
        }

        // Redirect to Mollie Connect URL with adminId
        window.location.href = `/mollie/connect?adminId=${adminId}`;
    }, [data]);

    // Loading state and error handling
    if (adminLoading) return <p>Loading administrator info...</p>;
    if (adminError) return <p>Error fetching administrator info: {adminError}</p>;

    return (
        <div>
            {mollieConnected ? (
                <p>Connected to Mollie</p>
            ) : (
                <button onClick={handleConnect} disabled={adminLoading} style={buttonStyles}>
                    {adminLoading ? 'Connecting...' : (
                        <>
                            Connect with
                            <svg style={logoStyles} viewBox="0 0 320 94" fill="#000000" xmlns="http://www.w3.org/2000/svg">
                                <path fillRule="evenodd" clipRule="evenodd" d="M289.3,44.3c6.9,0,13.2,4.5,15.4,11h-30.7C276.1,48.9,282.3,44.3,289.3,44.3z M320,60.9c0-8-3.1-15.6-8.8-21.4c-5.7-5.8-13.3-9-21.3-9h-0.4c-8.3,0.1-16.2,3.4-22.1,9.3c-5.9,5.9-9.2,13.7-9.3,22c-0.1,8.5,3.2,16.5,9.2,22.6c6.1,6.1,14.1,9.5,22.6,9.5h0c11.2,0,21.7-6,27.4-15.6l0.7-1.2l-12.6-6.2l-0.6,1c-3.1,5.2-8.6,8.2-14.7,8.2c-7.7,0-14.4-5.1-16.5-12.5H320V60.9z M241.2,19.8c-5.5,0-9.9-4.4-9.9-9.9c0-5.5,4.4-9.9,9.9-9.9s9.9,4.4,9.9,9.9C251.2,15.3,246.7,19.8,241.2,19.8z M233.6,92.7h15.2V31.8h-15.2V92.7z M204.5,1.3h15.2v91.5h-15.2V1.3z M175.4,92.7h15.2V1.3h-15.2V92.7z M135.3,79c-9.2,0-16.8-7.5-16.8-16.7c0-9.2,7.5-16.7,16.8-16.7s16.8,7.5,16.8,16.7C152.1,71.5,144.6,79,135.3,79z M135.3,30.5c-17.6,0-31.8,14.2-31.8,31.7S117.8,94,135.3,94c17.5,0,31.8-14.2,31.8-31.7S152.9,30.5,135.3,30.5z M70.4,30.6c-0.8-0.1-1.6-0.1-2.4-0.1c-7.7,0-15,3.1-20.2,8.7c-5.2-5.5-12.5-8.7-20.1-8.7C12.4,30.5,0,42.9,0,58v34.7h14.9V58.5c0-6.3,5.2-12.1,11.3-12.7c0.4,0,0.9-0.1,1.3-0.1c6.9,0,12.5,5.6,12.5,12.5v34.6h15.2V58.4c0-6.3,5.2-12.1,11.3-12.7c0.4,0,0.9-0.1,1.3-0.1c6.9,0,12.5,5.6,12.6,12.4v34.7h15.2V58.5c0-7-2.6-13.6-7.2-18.8C83.7,34.4,77.3,31.2,70.4,30.6z" />
                            </svg>
                        </>
                    )}
                </button>
            )}
        </div>
    );
};

// Define styles
const buttonStyles: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '8px 16px',
    backgroundColor: '#fff',
    color: '#000',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
    fontSize: '16px',
    fontWeight: 500,
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'border-color 0.3s ease',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
};

const logoStyles: React.CSSProperties = {
    height: '14px',
    marginLeft: '8px',
};

export default MollieConnectButton;
