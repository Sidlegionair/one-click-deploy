import { registerReactFormInputComponent } from '@vendure/admin-ui/react';
import PreferredSellerInput from './components/PreferredSellerInput';
import MollieConnectButton from './components/MollieconnectButton';

export default [
    registerReactFormInputComponent('preferred-seller-input', PreferredSellerInput),
    registerReactFormInputComponent('mollie-connect-button', MollieConnectButton),

];
