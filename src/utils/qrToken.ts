import { createHmac } from 'crypto';

// Contrato TOTP-like para el QR rotativo de kiosco: step de 30s, secreto en hex,
// HMAC-SHA256 + truncamiento dinámico RFC-4226, código de 8 dígitos. Debe coincidir
// byte a byte con la implementación del lado kiosco (app externa, js-sha256).
export const STEP_SECONDS = 30;
const DIGITS = 8;
const MODULUS = 10 ** DIGITS;

const counterToBuffer = (counter: number): Buffer => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    return buf;
};

// RFC-4226 dynamic truncation: el nibble bajo del último byte del HMAC elige un offset
// de 4 bytes; se enmascara el bit alto (evita signo negativo) y se toma mod 10^DIGITS.
// El HMAC-SHA256 siempre tiene 32 bytes, por lo que offset (0-15) y offset+3 (máx. 18)
// están siempre dentro del buffer: el `!` es seguro dado ese invariante.
const dynamicTruncate = (hmac: Buffer): number => {
    const lastByte = hmac[hmac.length - 1]!;
    const offset = lastByte & 0xf;
    const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
    return binary % MODULUS;
};

// Deriva el código rotativo de 8 dígitos para un secreto (hex) y un contador de step
// dados. Pura y determinística: mismo secreto + mismo counter -> mismo código siempre.
export const deriveQrCode = (secretHex: string, counter: number): string => {
    const secretBytes = Buffer.from(secretHex, 'hex');
    const counterBytes = counterToBuffer(counter);
    const hmac = createHmac('sha256', secretBytes).update(counterBytes).digest();
    const code = dynamicTruncate(hmac);
    return code.toString().padStart(DIGITS, '0');
};

// Valida un código rotativo contra el step actual (t) y el anterior (t−1), tolerando
// hasta ~60s de desfasaje/latencia entre el kiosco y el escaneo. Cualquier otro counter
// (incluido t−2 en adelante) se rechaza.
export const isValidRotatingToken = (secretHex: string, code: string, nowMs: number = Date.now()): boolean => {
    const counterNow = Math.floor(nowMs / 1000 / STEP_SECONDS);
    return code === deriveQrCode(secretHex, counterNow) || code === deriveQrCode(secretHex, counterNow - 1);
};
