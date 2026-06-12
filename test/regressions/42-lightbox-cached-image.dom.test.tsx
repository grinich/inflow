// @vitest-environment jsdom
// Regression: ImageLightbox ran its src through sanitizeUrl, which returns '#'
// for data:/blob: URLs. Cached attachment images (useCachedImage → FileReader
// data: URLs) and compose previews (blob: URLs) therefore failed to load and
// onError={close} instantly closed the lightbox.
import '../dom-setup';

import { render } from '@testing-library/react';
import { ImageLightbox } from '@/components/common/ImageLightbox';
import { useUIStore } from '@/store/ui-store';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('ImageLightbox cached images', () => {
  it('renders a data:image URL as the img src instead of "#"', () => {
    useUIStore.setState({ lightboxImageUrl: DATA_URL });
    const { container } = render(<ImageLightbox />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe(DATA_URL);
  });

  it('renders a blob: URL as the img src instead of "#"', () => {
    const blobUrl = 'blob:chrome-extension://abc/preview-1';
    useUIStore.setState({ lightboxImageUrl: blobUrl });
    const { container } = render(<ImageLightbox />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe(blobUrl);
  });

  it('still refuses javascript: URLs', () => {
    useUIStore.setState({ lightboxImageUrl: 'javascript:alert(1)' });
    const { container } = render(<ImageLightbox />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('#');
  });
});
