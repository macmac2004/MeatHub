import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isValidProductImage,
  MAX_PRODUCT_IMAGE_BYTES,
  productImageExtension
} from '../src/productImage.js';

test('product image validation accepts only supported image signatures and sizes', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = Buffer.from('RIFF0000WEBP', 'ascii');

  assert.equal(isValidProductImage(jpeg, 'image/jpeg'), true);
  assert.equal(isValidProductImage(png, 'image/png'), true);
  assert.equal(isValidProductImage(webp, 'image/webp'), true);
  assert.equal(isValidProductImage(jpeg, 'image/png'), false);
  assert.equal(isValidProductImage(Buffer.from('not an image'), 'image/jpeg'), false);
  assert.equal(isValidProductImage(Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES + 1), 'image/jpeg'), false);
  assert.equal(productImageExtension('image/webp'), 'webp');
});
