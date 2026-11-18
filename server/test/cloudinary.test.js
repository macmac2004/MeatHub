import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUploadSignature } from '../src/cloudinary.js';

test('Cloudinary upload signatures sort signed parameters and use the API secret', () => {
  const parameters = {
    timestamp: 1700000000,
    public_id: 'abc-123',
    folder: 'meathub/products/user-1'
  };

  assert.equal(
    createUploadSignature(parameters, 'secret'),
    '51f4b06e1f72fdc6088e0692eaabf0fe421913b6'
  );
  assert.notEqual(createUploadSignature(parameters, 'other-secret'), '51f4b06e1f72fdc6088e0692eaabf0fe421913b6');
});
