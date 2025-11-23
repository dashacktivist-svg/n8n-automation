'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, Zap, AlertCircle } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Persona {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  greeting?: string;
  avatar?: string;
}

export default function ChatbotPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const personaId = (params as any)?.personaId || searchParams?.get('persona');

  const [persona, setPersona] = useState<Persona | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [typingText, setTypingText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingPersona, setIsLoadingPersona] = useState(true);

  // NEW STATE — marks chat as ended
  const [isChatEnded, setIsChatEnded] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingIntervalRef = useRef<number | null>(null);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

  const scrollToBottom = (behaviour: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior: behaviour });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, typingText]);

  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) window.clearInterval(typingIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (personaId) fetchPersona(personaId as string);
    else {
      setError('No persona ID provided');
      setIsLoadingPersona(false);
    }
  }, [personaId]);

  const fetchPersona = async (id: string) => {
    try {
      setIsLoadingPersona(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/persona/${id}`);
      if (!response.ok) throw new Error((await response.text()) || 'Persona not found');

      const data = await response.json();
      const p: Persona = {
        id: data.id?.toString() ?? id,
        name: data.name ?? 'AI Assistant',
        description: data.description ?? '',
        systemPrompt: data.systemPrompt ?? data.system_prompt ?? '',
        greeting: data.greeting
      };

      setPersona(p);

      // Load greeting as first message
      if (p.greeting) {
        setMessages([
          {
            id: `greeting-${Date.now()}`,
            role: 'assistant',
            content: p.greeting,
            timestamp: new Date()
          }
        ]);
      } else setMessages([]);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chatbot');
      setMessages([]);
    } finally {
      setIsLoadingPersona(false);
    }
  };

  const typeMessage = (text: string) => {
    if (!text) {
      setIsTyping(false);
      setTypingText('');
      setIsLoading(false);
      return;
    }

    setIsTyping(true);
    setTypingText('');
    let index = 0;

    if (typingIntervalRef.current) window.clearInterval(typingIntervalRef.current);

    const interval = window.setInterval(() => {
      if (index < text.length) {
        setTypingText(prev => prev + text.charAt(index));
        index++;
      } else {
        window.clearInterval(interval);
        typingIntervalRef.current = null;

        setIsTyping(false);

        setMessages(prev => [
          ...prev,
          { id: Date.now().toString(), role: 'assistant', content: text, timestamp: new Date() }
        ]);

        setTypingText('');
        setIsLoading(false);
        setTimeout(() => scrollToBottom(), 10);
      }
    }, 5);

    typingIntervalRef.current = interval as unknown as number;
  };

  const handleSubmit = async () => {
    if (!input.trim() || isLoading || !personaId || isChatEnded) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const historyToSend = [...messages, userMessage].map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personaId,
          message: userMessage.content,
          conversationHistory: historyToSend
        })
      });

      if (!response.ok) throw new Error((await response.text()) || 'Failed to get response');

      const data = await response.json();
      typeMessage(data.response || data.message || '');

    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : 'Failed to send message');

      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: new Date()
        }
      ]);
    }
  };

  // NEW: End Chat – disable input, keep messages
  const handleEndChat = () => {
    if (typingIntervalRef.current) {
      window.clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }

    try {
      const response = fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationEnded: true,
          personaId,
          message: 'User has ended the conversation.',
          conversationHistory: messages.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        })
      });
    } catch (err) {
      console.error('Error notifying backend of chat end:', err);
      if (err instanceof Error) {
        setError(err.message);
      }
    }

    setIsChatEnded(true);
    setIsTyping(false);
    setTypingText('');
    setInput('');
    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (isLoadingPersona) {
    return (
      <div className="chat-wrapper">
        <div className="chat-container">
          <div className="loading-container">
            <div className="loading-spinner" />
            <p className="loading-text">Loading chatbot...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !persona) {
    return (
      <div className="chat-wrapper">
        <div className="chat-container">
          <div className="error-container">
            <AlertCircle size={48} className="error-icon" />
            <h2 className="error-title">Chatbot Not Found</h2>
            <p className="error-message">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-wrapper">
      <div className="chat-container">
        <div className="chat-header">
          <div className="header-content">
            <div className="logo-container">
              <Sparkles className="logo-sparkle" />
              <Bot className="logo-icon" />
            </div>
            <div className="header-text">
              <h1 className="header-title">{persona?.name || 'AI Assistant'}</h1>
              <p className="header-subtitle">{persona?.description || 'Powered by Gemini AI'}</p>
            </div>
          </div>

          <div className="status-indicator">
            <div className="status-dot" />
            <span className="status-text">{isChatEnded ? "Ended" : "Online"}</span>
          </div>
        </div>

        <div className="messages-container">
          <div className="messages-wrapper">
            
            {isChatEnded && (
              <div className="end-banner">
                Conversation ended.
              </div>
            )}

            {messages.map(msg => (
              <div
                key={msg.id}
                className={`message ${msg.role === 'user' ? 'message-user' : 'message-assistant'}`}
              >
                <div className="message-avatar">
                  {msg.role === 'user' ? (
                    <div className="avatar-user"><User size={18} /></div>
                  ) : (
                    <div className="avatar-assistant"><Zap size={18} /></div>
                  )}
                </div>

                <div className="message-content">
                  <div className="message-header">
                    <span className="message-role">
                      {msg.role === 'user' ? 'You' : persona?.name || 'AI Assistant'}
                    </span>
                    <span className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <div className="message-bubble"><p>{msg.content}</p></div>
                </div>
              </div>
            ))}

            {isTyping && !isChatEnded && (
              <div className="message message-assistant">
                <div className="message-avatar">
                  <div className="avatar-assistant"><Zap size={18} /></div>
                </div>
                <div className="message-content">
                  <div className="message-header">
                    <span className="message-role">{persona?.name}</span>
                    <span className="message-time typing-indicator-text">typing...</span>
                  </div>
                  <div className="message-bubble typing-bubble">
                    <p>{typingText}<span className="cursor-blink">|</span></p>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* HIDE INPUT WHEN CHAT ENDED */}
        {!isChatEnded && (
          <div className="input-section">
            <div className="input-container">
              <div className="input-wrapper">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything..."
                  className="message-input"
                  disabled={isLoading}
                />

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleEndChat}
                    className="end-chat-button"
                    title="End Conversation"
                  >
                    ✕
                  </button>

                  <button
                    onClick={handleSubmit}
                    disabled={!input.trim() || isLoading}
                    className="send-button"
                  >
                    <Send size={20} />
                  </button>
                </div>
              </div>

              <p className="input-hint">
                Press <kbd>Enter</kbd> to send, <kbd>Shift + Enter</kbd> for new line
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
