import { createHash, randomUUID } from 'node:crypto';

export function createUploadSignature(parameters, apiSecret) {
  const serialized = Object.entries(parameters)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('sha1').update(`${serialized}${apiSecret}`).digest('hex');
}

export async function uploadProductImage(buffer, contentType, ownerUid) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured on this server.');
  }

  const extension = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  }[contentType];
  if (!extension) throw new Error('Unsupported product image type.');

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `meathub/products/${ownerUid}`;
  const publicId = randomUUID();
  const parameters = { folder, public_id: publicId, timestamp };
  const signature = createUploadSignature(parameters, apiSecret);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), `product.${extension}`);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('public_id', publicId);
  form.append('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: 'POST',
    body: form
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.secure_url !== 'string') {
    const error = new Error(result.error?.message || `Cloudinary upload failed (${response.status}).`);
    error.statusCode = 502;
    throw error;
  }
  return { image: result.secure_url };
}
