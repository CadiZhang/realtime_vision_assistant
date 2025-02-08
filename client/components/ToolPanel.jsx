import { useEffect, useState } from "react";
import CameraModal from './CameraModal';

const VISION_TIMEOUT = 10000; // 10 seconds

const analyzeWithTimeout = async (imageData) => {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error("Vision analysis timeout")),
      VISION_TIMEOUT,
    );
  });

  try {
    const result = await Promise.race([
      fetch("/analyze-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData }),
      }),
      timeoutPromise,
    ]);
    return result;
  } catch (error) {
    throw error;
  }
};

export default function ToolPanel({
  isSessionActive,
  sendClientEvent,
  events,
  dataChannel,
}) {
  const [showCamera, setShowCamera] = useState(false);
  const [currentImageFilename, setCurrentImageFilename] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);

  useEffect(() => {
    if (!events || events.length === 0) return;

    const mostRecentEvent = events[0];
    console.log("Processing event:", {
      type: mostRecentEvent.type,
      function: mostRecentEvent.function,
      response: mostRecentEvent.response,
      content: mostRecentEvent.content
    });

    // Check for function calls in different possible locations
    if (mostRecentEvent.type === "function_call" || 
        (mostRecentEvent.type === "response.output_item.added" && 
         mostRecentEvent.response?.output?.type === "function_call") ||
        (mostRecentEvent.type === "response.done" && 
         mostRecentEvent.response?.output?.some(o => o.type === "function_call"))) {
      
      console.log("Found function call event:", mostRecentEvent);
      
      // Check if it's our take_photo function
      const functionName = mostRecentEvent.function?.name || 
                          mostRecentEvent.response?.output?.name ||
                          mostRecentEvent.response?.output?.find(o => o.type === "function_call")?.name;
      
      if (functionName === "take_photo") {
        console.log("Take photo function detected, showing camera...");
        setShowCamera(true);
        setAnalysisError(null);
      }
    }
  }, [events]);

  useEffect(() => {
    if (!isSessionActive) {
      setShowCamera(false);
      setIsAnalyzing(false);
      setCurrentImage(null);
      setAnalysisError(null);
      if (currentImageFilename) {
        cleanupSession(currentImageFilename);
        setCurrentImageFilename(null);
      }
    }
  }, [isSessionActive]);

  const cleanupSession = async (imageFilename) => {
    try {
      await fetch("/cleanup-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: imageFilename }),
      });
    } catch (error) {
      console.error("Cleanup failed:", error);
    }
  };

  const handlePhotoTaken = async (imageData) => {
    console.log("Photo taken");
    setShowCamera(false);
    setCurrentImage(imageData);
    setIsAnalyzing(true);
    setAnalysisError(null);
    
    try {
      // 1. First analyze the image - this is independent of WebRTC
      const response = await analyzeWithTimeout(imageData);
      const analysis = await response.json();
      console.log("Vision analysis complete:", analysis);
      setIsAnalyzing(false);

      // 2. Store the analysis result to show in UI regardless of WebRTC state
      const analysisText = analysis.message.content;
      
      // 3. Try to send results to model with exponential backoff
      const sendToModel = async () => {
        const maxAttempts = 5;
        const baseDelay = 1000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (!dataChannel || !isSessionActive) {
            console.log("Session no longer active, stopping retry");
            return;
          }

          if (dataChannel.readyState === 'open') {
            // First send function result
            await sendClientEvent({
              type: "function_result",
              function_call: {
                name: "take_photo",
                output: { success: true }
              },
            });

            // Then request a spoken response
            await sendClientEvent({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: analysisText
                  }
                ]
              }
            });

            // Finally trigger speech synthesis
            await sendClientEvent({
              type: "speech.output.start",
              speech: {
                voice: "verse",
                text: analysisText
              }
            });

            return;
          }

          // Exponential backoff
          const delay = baseDelay * Math.pow(2, attempt);
          console.log(`Channel not ready, retrying in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        throw new Error("Failed to send results to model - channel not available");
      };

      // 4. Send to model in background - don't block UI
      sendToModel().catch(error => {
        console.error("Failed to send to model:", error);
      });

    } catch (error) {
      console.error("Vision analysis failed:", error);
      setIsAnalyzing(false);
      setAnalysisError(error.message);

      if (error.message === "Vision analysis timeout") {
        const errorText = "Vision analysis timed out. Please try again.";
        setAnalysisError(errorText);
        
        if (dataChannel?.readyState === 'open') {
          // For errors, also ensure we get speech output
          await sendClientEvent({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: errorText
                }
              ]
            }
          });

          await sendClientEvent({
            type: "speech.output.start",
            speech: {
              voice: "verse",
              text: "I'm sorry, but the vision analysis timed out. Please try taking another photo."
            }
          });
        }
      }
    }
  };

  return (
    <>
      <section className="h-full w-full flex flex-col gap-4">
        <div className="h-full bg-gray-50 rounded-md p-4">
          <h2 className="text-lg font-bold">Vision Analysis Tool</h2>
          {isSessionActive ? (
            <div className="flex flex-col gap-4">
              <p>Say "take a photo" or "what do you see?" to analyze an image...</p>
              
              {currentImage && (
                <div className="relative rounded-lg overflow-hidden">
                  <img 
                    src={currentImage} 
                    alt="Captured" 
                    className="w-full h-auto rounded-lg"
                  />
                  {isAnalyzing && (
                    <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                      <div className="text-white text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                        <p>Analyzing image...</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {analysisError && (
                <div className="bg-red-50 text-red-700 p-3 rounded-md">
                  <p className="font-semibold">Analysis failed</p>
                  <p className="text-sm">{analysisError}</p>
                </div>
              )}
            </div>
          ) : (
            <p>Start the session to use this tool...</p>
          )}
        </div>
      </section>
      {showCamera && (
        <CameraModal
          onClose={() => setShowCamera(false)}
          onPhotoTaken={handlePhotoTaken}
        />
      )}
    </>
  );
}
