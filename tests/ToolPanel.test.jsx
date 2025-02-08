import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ToolPanel from '../client/components/ToolPanel';

// Mock CameraModal component
vi.mock('../client/components/CameraModal', () => ({
  default: ({ onClose, onPhotoTaken }) => (
    <div data-testid="camera-modal">
      <button onClick={onClose}>Close</button>
      <button onClick={() => onPhotoTaken('test-image-url')}>Take Photo</button>
    </div>
  )
}));

describe('ToolPanel Component', () => {
  const mockSendClientEvent = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  test('should show inactive state when session is not active', () => {
    render(
      <ToolPanel
        isSessionActive={false}
        sendClientEvent={mockSendClientEvent}
        events={[]}
      />
    );

    expect(screen.getByText(/start the session/i)).toBeInTheDocument();
  });

  test('should show active state with instructions when session is active', () => {
    render(
      <ToolPanel
        isSessionActive={true}
        sendClientEvent={mockSendClientEvent}
        events={[]}
      />
    );

    expect(screen.getByText(/say "take a photo"/i)).toBeInTheDocument();
  });

  test('should show camera modal when receiving take_photo function call', () => {
    render(
      <ToolPanel
        isSessionActive={true}
        sendClientEvent={mockSendClientEvent}
        events={[
          {
            type: 'function_call',
            function: { name: 'take_photo' }
          }
        ]}
      />
    );

    expect(screen.getByTestId('camera-modal')).toBeInTheDocument();
  });

  test('should handle photo capture and analysis flow', async () => {
    // Mock successful analysis response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        message: { content: 'Test analysis result' }
      })
    });

    render(
      <ToolPanel
        isSessionActive={true}
        sendClientEvent={mockSendClientEvent}
        events={[
          {
            type: 'function_call',
            function: { name: 'take_photo' }
          }
        ]}
      />
    );

    // Take photo
    fireEvent.click(screen.getByText('Take Photo'));

    // Check loading state
    expect(screen.getByText(/analyzing image/i)).toBeInTheDocument();

    // Wait for analysis to complete
    await waitFor(() => {
      expect(mockSendClientEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'response.create',
          response: expect.objectContaining({
            content: expect.objectContaining({
              text: 'Test analysis result'
            })
          })
        })
      );
    });
  });

  test('should handle analysis error', async () => {
    // Mock failed analysis response
    global.fetch.mockRejectedValueOnce(new Error('Analysis failed'));

    render(
      <ToolPanel
        isSessionActive={true}
        sendClientEvent={mockSendClientEvent}
        events={[
          {
            type: 'function_call',
            function: { name: 'take_photo' }
          }
        ]}
      />
    );

    // Take photo
    fireEvent.click(screen.getByText('Take Photo'));

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText(/analysis failed/i)).toBeInTheDocument();
    });
  });

  test('should cleanup on session end', async () => {
    // Mock successful cleanup response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true })
    });

    const { rerender } = render(
      <ToolPanel
        isSessionActive={true}
        sendClientEvent={mockSendClientEvent}
        events={[]}
      />
    );

    // Simulate photo taken
    fireEvent.click(screen.getByText('Take Photo'));

    // End session
    rerender(
      <ToolPanel
        isSessionActive={false}
        sendClientEvent={mockSendClientEvent}
        events={[]}
      />
    );

    // Verify cleanup was called
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/cleanup-image',
        expect.any(Object)
      );
    });
  });
}); 