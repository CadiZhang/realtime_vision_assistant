import { useEffect, useRef, useState } from "react";
import logo from "/assets/openai-logomark.svg";
import EventLog from "./EventLog";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";

export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [dataChannel, setDataChannel] = useState(null);
  const [imageAnalysis, setImageAnalysis] = useState({
    imageData: null,
    analysisText: null,
    isLoading: false
  });
  const peerConnection = useRef(null);
  const audioElement = useRef(null);

  async function startSession() {
    // Get a session token for OpenAI Realtime API
    const tokenResponse = await fetch("/token");
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data.client_secret.value;

    // Create a peer connection
    const pc = new RTCPeerConnection();

    // Set up to play remote audio from the model
    audioElement.current = document.createElement("audio");
    audioElement.current.autoplay = true;
    pc.ontrack = (e) => (audioElement.current.srcObject = e.streams[0]);

    // Add local audio track for microphone input in the browser
    const ms = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    pc.addTrack(ms.getTracks()[0]);

    // Set up data channel for sending and receiving events
    const dc = pc.createDataChannel("oai-events");
    setDataChannel(dc);

    // Start the session using the Session Description Protocol (SDP)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-realtime-preview-2024-12-17";
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        "Content-Type": "application/sdp",
      },
    });

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);

    peerConnection.current = pc;
  }

  // Stop current session, clean up peer connection and data channel
  function stopSession() {
    if (dataChannel) {
      dataChannel.close();
    }

    peerConnection.current.getSenders().forEach((sender) => {
      if (sender.track) {
        sender.track.stop();
      }
    });

    if (peerConnection.current) {
      peerConnection.current.close();
    }

    setIsSessionActive(false);
    setDataChannel(null);
    peerConnection.current = null;
  }

  // Send a message to the model
  function sendClientEvent(message) {
    if (dataChannel) {
      const timestamp = new Date().toLocaleTimeString();
      message.event_id = message.event_id || crypto.randomUUID();

      console.log("📤 Sending client event:", message.type, message);
      
      // send event before setting timestamp since the backend peer doesn't expect this field
      try {
        dataChannel.send(JSON.stringify(message));
        console.log("✅ Event sent successfully");
      } catch (error) {
        console.error("❌ Failed to send event:", error);
      }

      // if guard just in case the timestamp exists by miracle
      if (!message.timestamp) {
        message.timestamp = timestamp;
      }
      setEvents((prev) => [message, ...prev]);
    } else {
      console.error(
        "❌ Failed to send message - no data channel available",
        message,
      );
    }
  }

  // Send a text message to the model
  function sendTextMessage(message) {
    const event = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: message,
          },
        ],
      },
    };

    sendClientEvent(event);
    sendClientEvent({ type: "response.create" });
  }

  // Handle take picture tool call
  async function handleTakePicture(params) {
    console.log("🔍 handleTakePicture called with params:", params);
    
    try {
      setImageAnalysis({ ...imageAnalysis, isLoading: true });
      console.log("📷 Setting image analysis loading state");
      
      // Call the server endpoint to capture an image from the ESP32 camera
      console.log("📤 Sending request to /capture-image endpoint with camera URL:", 'http://192.168.1.6:81/stream');
      const response = await fetch('/capture-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cameraUrl: 'http://192.168.1.6:81/stream',
          prompt: params.prompt || "What's in this image?"
        }),
      });
      
      console.log("📥 Received response from /capture-image, status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Error response from /capture-image:", errorText);
        throw new Error(`Failed to capture image: ${response.statusText}. Details: ${errorText}`);
      }
      
      const data = await response.json();
      console.log("✅ Successfully parsed response data, image size:", 
        data.imageData ? `${Math.round(data.imageData.length / 1024)}KB` : 'none',
        "analysis length:", data.analysis ? data.analysis.length : 'none');
      
      // Now we have the base64 image, set it in our state
      setImageAnalysis({
        imageData: data.imageData,
        analysisText: data.analysis,
        isLoading: false
      });
      console.log("🖼️ Updated image analysis state with results");
      
      // Return result to be displayed to the user
      return {
        status: 'success',
        result: data.analysis
      };
    } catch (error) {
      console.error("❌ Error in handleTakePicture:", error);
      setImageAnalysis({
        ...imageAnalysis,
        isLoading: false,
        analysisText: `Error: ${error.message}`
      });
      
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  // Attach event listeners to the data channel when a new one is created
  useEffect(() => {
    if (dataChannel) {
      // Append new server events to the list
      dataChannel.addEventListener("message", (e) => {
        const event = JSON.parse(e.data);
        if (!event.timestamp) {
          event.timestamp = new Date().toLocaleTimeString();
        }

        console.log("📩 Received event from data channel:", event.type, event);

        // Check if the event is a tool call for take_picture
        if (event.type === "tool_call" && event.name === "take_picture") {
          console.log("🔧 Detected take_picture tool call, params:", event.parameters);
          console.log("🔍 Tool call event structure:", JSON.stringify(event, null, 2));
          
          // Log all possible call_id locations
          console.log("🆔 Possible call_id locations:", {
            "event.id": event.id,
            "event.call_id": event.call_id,
            "event.tool_call_id": event.tool_call_id
          });
          
          handleTakePicture(event.parameters || {})
            .then(result => {
              console.log("🔄 Tool call completed, creating function_call_output");
              
              // Create a conversation item with the function call output
              sendClientEvent({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: event.id,
                  output: JSON.stringify({
                    status: "success", 
                    result: result.result
                  })
                }
              });
              
              // After creating the output item, request a response
              setTimeout(() => {
                console.log("🔊 Requesting model response based on function output");
                sendClientEvent({
                  type: "response.create"
                });
              }, 500);
            })
            .catch(error => {
              console.error("❌ Tool call failed:", error);
              
              // Create a conversation item with the error
              sendClientEvent({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: event.id,
                  output: JSON.stringify({
                    status: "error",
                    error: error.message
                  })
                }
              });
              
              // Request a response to verbalize the error
              setTimeout(() => {
                console.log("🔊 Requesting model response for error");
                sendClientEvent({
                  type: "response.create"
                });
              }, 500);
            });
        }
        
        // Handle function call events (alternative way the model might invoke tools)
        if (event.type === "response.output_item.done" && 
            event.item && 
            event.item.type === "function_call" && 
            event.item.name === "take_picture") {
          
          console.log("🔧 Detected take_picture function call via output item:", event.item);
          console.log("🔍 Function call event structure:", JSON.stringify(event, null, 2));
          
          // Log all possible call_id locations
          console.log("🆔 Possible call_id locations:", {
            "event.item.call_id": event.item.call_id,
            "event.item.id": event.item.id,
            "event.response_id": event.response_id,
            "event.item_id": event.item_id
          });
          
          // Parse parameters from the function call arguments
          let params = {};
          try {
            if (event.item.arguments) {
              params = JSON.parse(event.item.arguments);
            }
          } catch (error) {
            console.error("❌ Error parsing function arguments:", error);
          }
          
          console.log("🔧 Parsed function parameters:", params);
          
          handleTakePicture(params)
            .then(result => {
              console.log("🔄 Function call completed, creating function_call_output");
              
              // Create a conversation item with the function call output
              sendClientEvent({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: event.item.call_id,
                  output: JSON.stringify({
                    status: "success", 
                    result: result.result
                  })
                }
              });
              
              // After creating the output item, request a response
              setTimeout(() => {
                console.log("🔊 Requesting model response based on function output");
                sendClientEvent({
                  type: "response.create"
                });
              }, 500);
            })
            .catch(error => {
              console.error("❌ Function call failed:", error);
              
              // Create a conversation item with the error
              sendClientEvent({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: event.item.call_id,
                  output: JSON.stringify({
                    status: "error",
                    error: error.message
                  })
                }
              });
              
              // Request a response to verbalize the error
              setTimeout(() => {
                console.log("🔊 Requesting model response for error");
                sendClientEvent({
                  type: "response.create"
                });
              }, 500);
            });
        }

        setEvents((prev) => [event, ...prev]);
      });

      // Set session active when the data channel is opened
      dataChannel.addEventListener("open", () => {
        setIsSessionActive(true);
        setEvents([]);
        
        // Register the take_picture tool when the session starts
        console.log("🛠️ Registering take_picture tool");
        const toolUpdateEvent = {
          type: "session.update",
          session: {
            tools: [
              {
                type: "function",
                name: "take_picture",
                description: "Captures an image from the ESP32 camera and analyzes its contents. Use this when the user asks to take a picture, capture an image, analyze what's in the camera, or similar requests.",
                parameters: {
                  type: "object",
                  properties: {
                    prompt: {
                      type: "string",
                      description: "Optional prompt to guide the image analysis. If not provided, a general description will be returned.",
                    }
                  },
                  required: []
                }
              }
            ],
            tool_choice: "auto"
          }
        };
        console.log("📤 Sending tool registration event:", toolUpdateEvent);
        sendClientEvent(toolUpdateEvent);
      });
    }
  }, [dataChannel]);

  // Debug tool registration status
  useEffect(() => {
    if (isSessionActive) {
      console.log("🧰 Active session tools status:", {
        isTakePictureToolRegistered: events.some(
          event => 
            event.type === "session.update" && 
            event.session?.tools?.some(tool => tool.name === "take_picture")
        ),
        toolRegistrationEvents: events.filter(
          event => event.type === "session.update"
        ),
        allTools: events
          .filter(event => event.type === "session.update")
          .flatMap(event => event.session?.tools || [])
          .map(tool => tool.name)
      });
      
      // Look for potential tool call events
      const toolCallEvents = events.filter(event => event.type === "tool_call");
      if (toolCallEvents.length > 0) {
        console.log("🔧 Tool call events detected:", toolCallEvents);
      }
    }
  }, [events, isSessionActive]);

  useEffect(() => {
    // Expose the handleTakePicture function to the window for testing
    window.testTakePicture = () => {
      console.log("🧪 Test button clicked - manually triggering image capture");
      
      // Generate a mock function call ID for testing
      const mockCallId = `test_call_${Date.now()}`;
      
      handleTakePicture({ prompt: "Test image - what's in this picture?" })
        .then(result => {
          console.log("🔄 Test: Creating function_call_output");
          
          if (dataChannel) {
            // Create a conversation item with the function call output
            sendClientEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: mockCallId,
                output: JSON.stringify({
                  status: "success", 
                  result: result.result
                })
              }
            });
            
            // After creating the output item, request a response
            setTimeout(() => {
              console.log("🔊 Test: Requesting model response");
              sendClientEvent({
                type: "response.create"
              });
            }, 500);
          }
        })
        .catch(error => {
          console.error("❌ Test: Image capture error:", error);
          
          if (dataChannel) {
            // Create a conversation item with the error
            sendClientEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: mockCallId,
                output: JSON.stringify({
                  status: "error",
                  error: error.message
                })
              }
            });
            
            // Request a response to verbalize the error
            setTimeout(() => {
              console.log("🔊 Test: Requesting model response for error");
              sendClientEvent({
                type: "response.create"
              });
            }, 500);
          }
        });
    };
    
    return () => {
      // Clean up when the component unmounts
      delete window.testTakePicture;
    };
  }, [dataChannel]);

  return (
    <>
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
        <div className="flex items-center gap-4 w-full m-4 pb-2 border-0 border-b border-solid border-gray-200">
          <img style={{ width: "24px" }} src={logo} />
          <h1>realtime console</h1>
        </div>
      </nav>
      <main className="absolute top-16 left-0 right-0 bottom-0">
        <section className="absolute top-0 left-0 right-[380px] bottom-0 flex">
          <section className="absolute top-0 left-0 right-0 bottom-32 px-4 overflow-y-auto">
            <EventLog events={events} />
          </section>
          <section className="absolute h-32 left-0 right-0 bottom-0 p-4">
            <SessionControls
              startSession={startSession}
              stopSession={stopSession}
              sendClientEvent={sendClientEvent}
              sendTextMessage={sendTextMessage}
              events={events}
              isSessionActive={isSessionActive}
            />
          </section>
        </section>
        <section className="absolute top-0 w-[380px] right-0 bottom-0 p-4 pt-0 overflow-y-auto">
          <ToolPanel
            sendClientEvent={sendClientEvent}
            sendTextMessage={sendTextMessage}
            events={events}
            isSessionActive={isSessionActive}
            imageAnalysis={imageAnalysis}
          />
        </section>
      </main>
    </>
  );
}
