import { readFileSync } from 'node:fs';
import { imageSize } from './image-size.js';

const landing = '../digo-landing/public';

describe('imageSize', () => {
  it.each([
    ['promociones/digo-promo-1.jpg', 'jpg'],
    ['nosotros/fusion-fibra.webp', 'webp'],
    ['brand/digo-logo-256.png', 'png'],
  ])('lee %s', (file, ext) => {
    let buffer: Buffer;
    try {
      buffer = readFileSync(`${landing}/${file}`);
    } catch {
      return; // El repo de la landing no está al lado: se omite.
    }
    const { width, height } = imageSize(buffer, ext);
    expect(width).toBeGreaterThan(10);
    expect(height).toBeGreaterThan(10);
  });

  it('lee las medidas exactas de la foto de Nosotros', () => {
    try {
      const buffer = readFileSync(`${landing}/nosotros/fusion-fibra.webp`);
      expect(imageSize(buffer, 'webp')).toEqual({ width: 820, height: 670 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  });
});
