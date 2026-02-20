declare module 'steam-totp' {
  const SteamTotp: {
    generateAuthCode: (sharedSecret: string) => string;
    getConfirmationKey: (identitySecret: string, time: number, tag: string) => string;
    getDeviceID: (steamId: string) => string;
  };

  export default SteamTotp;
}
