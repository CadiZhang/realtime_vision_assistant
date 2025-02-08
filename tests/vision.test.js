import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import fs from 'fs/promises';
import fetch from 'node-fetch';

// Mock the OpenAI client
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: "This is a test image analysis"
            }
          }]
        })
      }
    }
  }))
}));

// Mock fetch for WebRTC session
global.fetch = fetch;

describe('Vision Integration Tests', () => {
  const TEST_UPLOAD_DIR = join(process.cwd(), 'test-uploads');
  const TEST_IMAGE = Buffer.from('fake-image-data');

  beforeEach(async () => {
    // Create test upload directory
    await fs.mkdir(TEST_UPLOAD_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test files
    try {
      const files = await fs.readdir(TEST_UPLOAD_DIR);
      await Promise.all(
        files.map(file => fs.unlink(join(TEST_UPLOAD_DIR, file)))
      );
      await fs.rmdir(TEST_UPLOAD_DIR);
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  });

  test('Image upload endpoint should handle file upload correctly', async () => {
    const response = await fetch('http://localhost:3000/upload-image', {
      method: 'POST',
      body: TEST_IMAGE,
      headers: {
        'Content-Type': 'image/jpeg'
      }
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.url).toBeDefined();
    expect(data.url).toMatch(/^http:\/\/localhost:3000\/uploads\/.+\.jpg$/);
  });

  test('Vision analysis endpoint should process images correctly', async () => {
    const imageUrl = 'http://localhost:3000/uploads/test.jpg';
    const response = await fetch('http://localhost:3000/analyze-image', {
      method: 'POST',
      body: JSON.stringify({ imageUrl }),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.message.content).toBe('This is a test image analysis');
  });

  test('Cleanup endpoint should remove uploaded files', async () => {
    // First upload a test file
    const testFile = join(TEST_UPLOAD_DIR, 'test.jpg');
    await fs.writeFile(testFile, TEST_IMAGE);

    const response = await fetch('http://localhost:3000/cleanup-image', {
      method: 'POST',
      body: JSON.stringify({ filename: 'test.jpg' }),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    // Verify file was deleted
    await expect(fs.access(testFile)).rejects.toThrow();
  });

  test('WebRTC session should handle vision function calls', async () => {
    const response = await fetch('http://localhost:3000/token');
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.client_secret).toBeDefined();
    expect(data.client_secret.value).toBeDefined();
  });

  test('Should handle vision analysis timeout', async () => {
    // Mock a slow response
    vi.mock('openai', () => ({
      default: vi.fn().mockImplementation(() => ({
        chat: {
          completions: {
            create: vi.fn().mockImplementation(() => new Promise(resolve => {
              setTimeout(resolve, 11000); // Longer than our timeout
            }))
          }
        }
      }))
    }));

    const imageUrl = 'http://localhost:3000/uploads/test.jpg';
    const response = await fetch('http://localhost:3000/analyze-image', {
      method: 'POST',
      body: JSON.stringify({ imageUrl }),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Vision analysis failed');
  });

  test('Should handle invalid image URLs', async () => {
    const response = await fetch('http://localhost:3000/analyze-image', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: 'invalid-url' }),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Vision analysis failed');
  });
});

// UI Component Tests
describe('ToolPanel Component Tests', () => {
  test('Should show camera modal when receiving take_photo function call', () => {
    // Add React Testing Library tests here
  });

  test('Should show loading state during analysis', () => {
    // Add React Testing Library tests here
  });

  test('Should show error state when analysis fails', () => {
    // Add React Testing Library tests here
  });

  test('Should cleanup images when session ends', () => {
    // Add React Testing Library tests here
  });
}); 