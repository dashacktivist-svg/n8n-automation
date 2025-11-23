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
  const [isChatEnded, setIsChatEnded] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingIntervalRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    // small timeout ensures mobile keyboard & layout settle
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior }), 50);
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

    // Slightly slower on mobile to feel natural
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
        setTimeout(() => scrollToBottom(), 30);
      }
    }, 12);

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

      // on mobile, ensure input loses focus so keyboard can hide if needed
      inputRef.current?.blur();

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

  const handleEndChat = () => {
    if (typingIntervalRef.current) {
      window.clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }

    try {
      // fire-and-forget notify; don't await so UI responds instantly
      fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationEnded: true,
          personaId,
          message: 'User has ended the conversation.',
          conversationHistory: messages.map(msg => ({ role: msg.role, content: msg.content }))
        })
      });
    } catch (err) {
      console.error('Error notifying backend of chat end:', err);
      if (err instanceof Error) setError(err.message);
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

  // ensure input is visible when focused (helpful on iOS)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const onFocus = () => setTimeout(() => scrollToBottom('smooth'), 300);
    el.addEventListener('focus', onFocus);
    return () => el.removeEventListener('focus', onFocus);
  }, [inputRef.current]);

  if (isLoadingPersona) {
    return (
      <div className="chat-wrapper min-h-screen flex items-center justify-center bg-background">
        <div className="chat-container w-full max-w-xl mx-4 md:mx-auto">
          <div className="loading-container p-6 rounded-xl bg-surface">
            <div className="loading-spinner mb-3" />
            <p className="loading-text">Loading chatbot...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !persona) {
    return (
      <div className="chat-wrapper min-h-screen flex items-center justify-center bg-background p-4">
        <div className="chat-container w-full max-w-xl mx-auto">
          <div className="error-container p-6 rounded-xl bg-surface">
            <AlertCircle size={48} className="error-icon" />
            <h2 className="error-title mt-2">Chatbot Not Found</h2>
            <p className="error-message mt-1">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-wrapper min-h-screen flex flex-col bg-background text-white">
      {/* Header - sticky on top */}
      <header className="chat-header sticky top-0 z-20 bg-surface/90 backdrop-blur-md border-b border-surface-light">
        <div className="max-w-3xl mx-auto px-3 md:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="logo-container p-2 rounded-lg bg-primary/10 md:p-3">
              <div className="flex items-center gap-2">
                <Sparkles className="logo-sparkle" />
                <Bot className="logo-icon" />
              </div>
            </div>
            <div className="header-text leading-tight">
              <h1 className="header-title text-sm md:text-lg font-semibold">{persona?.name || 'AI Assistant'}</h1>
              <p className="header-subtitle text-xs md:text-sm text-surface-light truncate max-w-xs">{persona?.description || 'Powered by Gemini AI'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="status-indicator flex items-center gap-2">
              <div className={`status-dot h-2 w-2 rounded-full ${isChatEnded ? 'bg-gray-500' : 'bg-green-400'}`} />
              <span className="status-text text-xs">{isChatEnded ? 'Ended' : 'Online'}</span>
            </div>

            <button
              onClick={handleEndChat}
              className="end-chat-button p-2 rounded-md text-sm md:text-base hover:bg-surface-light/20"
              aria-label="End conversation"
            >
              End
            </button>
          </div>
        </div>
      </header>

      {/* Messages area - grow to fill available space */}
      <main className="messages-container flex-1 overflow-auto px-3 md:px-6 py-3">
        <div className="max-w-3xl mx-auto messages-wrapper flex flex-col gap-3">

          {isChatEnded && (
            <div className="end-banner text-center text-sm text-surface-light py-2 bg-surface/60 rounded-md">
              Conversation ended.
            </div>
          )}

          {messages.map(msg => (
            <div
              key={msg.id}
              className={`message flex gap-3 items-start ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {/* Avatar - smaller on mobile */}
              <div className={`message-avatar ${msg.role === 'user' ? 'order-2' : 'order-1'}`}>
                {msg.role === 'user' ? (
                  <div className="avatar-user w-8 h-8 md:w-10 md:h-10 rounded-full bg-surface flex items-center justify-center">
                    <User size={16} />
                  </div>
                ) : (
                  <div className="avatar-assistant w-8 h-8 md:w-10 md:h-10 rounded-full bg-surface flex items-center justify-center">
                    <Zap size={16} />
                  </div>
                )}
              </div>

              <div className={`message-content max-w-[78%] ${msg.role === 'user' ? 'order-1 text-right' : 'order-2 text-left'}`}>
                <div className="message-header text-xxs text-surface-light mb-1 flex items-center justify-between">
                  <span className="message-role text-xs font-medium">{msg.role === 'user' ? 'You' : persona?.name || 'AI Assistant'}</span>
                  <span className="message-time text-xs text-surface-light">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                <div className={`message-bubble inline-block p-3 rounded-2xl shadow-sm ${msg.role === 'user' ? 'bg-primary/80 text-white ml-auto' : 'bg-surface-light/10 text-white'}`}>
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>
              </div>
            </div>
          ))}

          {isTyping && !isChatEnded && (
            <div className="message flex gap-3 items-start">
              <div className="message-avatar order-1">
                <div className="avatar-assistant w-8 h-8 rounded-full bg-surface flex items-center justify-center"><Zap size={16} /></div>
              </div>

              <div className="message-content order-2 max-w-[78%]">
                <div className="message-header text-xxs text-surface-light mb-1">
                  <span className="message-role text-xs">{persona?.name}</span>
                  <span className="message-time typing-indicator-text text-xs text-surface-light">typing...</span>
                </div>
                <div className="message-bubble typing-bubble inline-block p-3 rounded-2xl bg-surface-light/10">
                  <p className="whitespace-pre-wrap break-words">{typingText}<span className="cursor-blink">|</span></p>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input area - fixed to bottom on mobile, respects safe-area */}
      {!isChatEnded && (
        <div className="input-section sticky bottom-0 z-30 bg-surface/95 backdrop-blur-md border-t border-surface-light" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="max-w-3xl mx-auto px-3 md:px-6 py-3">
            <div className="input-container bg-transparent">
              <div className="input-wrapper flex items-end gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything..."
                  className="message-input flex-1 min-h-[44px] md:min-h-[48px] px-4 py-2 rounded-lg bg-surface placeholder:text-surface-light focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={isLoading}
                  aria-label="Message input"
                />

                <button
                  onClick={handleSubmit}
                  disabled={!input.trim() || isLoading}
                  className="send-button p-3 rounded-lg flex items-center justify-center disabled:opacity-50"
                  aria-label="Send message"
                >
                  <Send size={18} />
                </button>

                <button
                  onClick={handleEndChat}
                  className="end-chat-button p-3 rounded-lg ml-1"
                  title="End Conversation"
                  aria-label="End conversation"
                >
                  ✕
                </button>
              </div>

              <p className="input-hint text-xs text-surface-light mt-2">Press <kbd className="px-1 py-0.5 rounded bg-surface">Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-surface">Shift + Enter</kbd> for new line</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
