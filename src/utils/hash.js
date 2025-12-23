import { createHash } from 'crypto';
import { createReadStream } from 'fs';
export async function getFileHash(filePath, algorithm = 'md5') {
    return new Promise((resolve, reject) => {
        const hash = createHash(algorithm);
        const stream = createReadStream(filePath);
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}
export async function getFileHashPartial(filePath, bytes = 1024 * 1024, algorithm = 'md5') {
    return new Promise((resolve, reject) => {
        const hash = createHash(algorithm);
        const stream = createReadStream(filePath, { start: 0, end: bytes - 1 });
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}
//# sourceMappingURL=hash.js.map