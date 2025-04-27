import { useEffect, useState } from "react";

const functionDescription = `
Call this function when a user asks for a color palette.
`;

const sessionUpdate = {
  type: "session.update",
  session: {
    tools: [
      {
        type: "function",
        name: "display_color_palette",
        description: functionDescription,
        parameters: {
          type: "object",
          strict: true,
          properties: {
            theme: {
              type: "string",
              description: "Description of the theme for the color scheme.",
            },
            colors: {
              type: "array",
              description: "Array of five hex color codes based on the theme.",
              items: {
                type: "string",
                description: "Hex color code",
              },
            },
          },
          required: ["theme", "colors"],
        },
      },
    ],
    tool_choice: "auto",
  },
};

function FunctionCallOutput({ functionCallOutput }) {
  const { theme, colors } = JSON.parse(functionCallOutput.arguments);

  const colorBoxes = colors.map((color) => (
    <div
      key={color}
      className="w-full h-16 rounded-md flex items-center justify-center border border-gray-200"
      style={{ backgroundColor: color }}
    >
      <p className="text-sm font-bold text-black bg-slate-100 rounded-md p-2 border border-black">
        {color}
      </p>
    </div>
  ));

  return (
    <div className="flex flex-col gap-2">
      <p>Theme: {theme}</p>
      {colorBoxes}
      <pre className="text-xs bg-gray-100 rounded-md p-2 overflow-x-auto">
        {JSON.stringify(functionCallOutput, null, 2)}
      </pre>
    </div>
  );
}

function ImageAnalysisOutput({ imageData, analysisText, isLoading }) {
  return (
    <div className="flex flex-col gap-2">
      {imageData && (
        <div className="mb-4">
          <img
            src={imageData}
            alt="Captured"
            className="w-full max-h-40 object-contain rounded-md border border-gray-200"
          />
        </div>
      )}
      
      {isLoading ? (
        <div className="text-sm text-gray-700">Analyzing image...</div>
      ) : (
        analysisText && (
          <div>
            <h3 className="font-medium mb-2">Analysis:</h3>
            <p className="text-sm overflow-y-auto max-h-60 bg-gray-50 p-3 rounded-md">{analysisText}</p>
          </div>
        )
      )}
    </div>
  );
}

export default function ToolPanel({
  isSessionActive,
  sendClientEvent,
  events,
  imageAnalysis = {}
}) {
  const [functionAdded, setFunctionAdded] = useState(false);
  const [functionCallOutput, setFunctionCallOutput] = useState(null);
  const { imageData, analysisText, isLoading } = imageAnalysis;

  // Function to manually trigger image capture (for testing)
  const testCaptureImage = () => {
    console.log("🧪 Manually triggering image capture test");
    
    // Create a simulated function call event
    const testEvent = {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        name: "take_picture",
        id: "test_" + Date.now(),
        arguments: JSON.stringify({
          prompt: "Test image analysis - what do you see in this image?"
        })
      }
    };

    // Dispatch the event as if it came from the model
    if (sendClientEvent) {
      console.log("📤 Dispatching test function call event:", testEvent);
      const customEvent = new CustomEvent('message', {
        detail: {
          data: JSON.stringify(testEvent)
        }
      });
      
      // Find the data channel element and dispatch the event
      const dataChannelElement = document.getElementById('dataChannel');
      if (dataChannelElement) {
        dataChannelElement.dispatchEvent(customEvent);
      } else {
        console.error("❌ Could not find dataChannel element for test event");
      }
    }
  };

  // Add debugging for imageAnalysis changes
  useEffect(() => {
    console.log("📊 ToolPanel received imageAnalysis update:", {
      hasImageData: !!imageData,
      analysisLength: analysisText ? analysisText.length : 0,
      isLoading
    });
  }, [imageData, analysisText, isLoading]);

  useEffect(() => {
    if (!events || events.length === 0) return;

    // Log new events for debugging
    const newEvent = events[0];
    if (newEvent) {
      console.log("📋 ToolPanel received new event:", newEvent.type, newEvent);
    }

    const firstEvent = events[events.length - 1];
    if (!functionAdded && firstEvent.type === "session.created") {
      console.log("🔄 Adding color palette function");
      sendClientEvent(sessionUpdate);
      setFunctionAdded(true);
    }

    const mostRecentEvent = events[0];
    if (
      mostRecentEvent.type === "response.done" &&
      mostRecentEvent.response.output
    ) {
      console.log("🎨 Checking for color palette output in response");
      mostRecentEvent.response.output.forEach((output) => {
        if (
          output.type === "function_call" &&
          output.name === "display_color_palette"
        ) {
          console.log("🎨 Found color palette function call");
          setFunctionCallOutput(output);
          setTimeout(() => {
            console.log("💬 Sending follow-up response");
            sendClientEvent({
              type: "response.create",
              response: {
                instructions: `
                ask for feedback about the color palette - don't repeat 
                the colors, just ask if they like the colors.
              `,
              },
            });
          }, 500);
        }
      });
    }
  }, [events, functionAdded, sendClientEvent]);

  useEffect(() => {
    if (!isSessionActive) {
      setFunctionAdded(false);
      setFunctionCallOutput(null);
    }
  }, [isSessionActive]);

  return (
    <section className="h-full w-full flex flex-col gap-4">
      <div className="h-1/2 bg-gray-50 rounded-md p-4">
        <h2 className="text-lg font-bold">Color Palette Tool</h2>
        {isSessionActive ? (
          functionCallOutput ? (
            <FunctionCallOutput functionCallOutput={functionCallOutput} />
          ) : (
            <p>Ask for advice on a color palette...</p>
          )
        ) : (
          <p>Start the session to use this tool...</p>
        )}
      </div>
      
      <div className="h-1/2 bg-gray-50 rounded-md p-4">
        <h2 className="text-lg font-bold">Camera Analysis</h2>
        {isSessionActive ? (
          <>
            {/* Add test button */}
            <div className="mb-4">
              <button 
                onClick={() => {
                  // Directly call the handleTakePicture function from App.jsx
                  // This requires passing handleTakePicture down to ToolPanel
                  window.testTakePicture && window.testTakePicture();
                }}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Test Camera Capture
              </button>
            </div>
            
            {imageData || isLoading || analysisText ? (
              <ImageAnalysisOutput
                imageData={imageData}
                analysisText={analysisText}
                isLoading={isLoading}
              />
            ) : (
              <p>Say "take a picture" to analyze the camera feed...</p>
            )}
          </>
        ) : (
          <p>Start the session to use this tool...</p>
        )}
      </div>
    </section>
  );
}
