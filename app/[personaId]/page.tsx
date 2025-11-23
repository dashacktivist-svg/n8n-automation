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

  // Scroll helper: slight delay helps mobile keyboard/layout settle
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior }), 60);
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

  // Typing effect: append a couple of chars per tick to reduce re-renders on long text
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

    const step = 2; // append 2 chars per tick for speed+smoothness
    const interval = window.setInterval(() => {
      if (index < text.length) {
        const slice = text.slice(index, index + step);
        setTypingText(prev => prev + slice);
        index += step;
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
    }, 14);

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

      // blur so keyboard can hide on mobile after send
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
      // fire-and-forget notify; UI shouldn't block
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

  // ensure input visible on focus (iOS/Android)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onFocus = () => setTimeout(() => scrollToBottom('auto'), 250);
    el.addEventListener('focus', onFocus);
    return () => el.removeEventListener('focus', onFocus);
  }, [inputRef.current]);

  if (isLoadingPersona) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="w-full max-w-lg mx-4 p-6 bg-gray-800 rounded-lg">
          <div className="animate-pulse h-4 bg-gray-700 rounded mb-3" />
          <p>Loading chatbot...</p>
        </div>
      </div>
    );
  }

  if (error && !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-4">
        <div className="w-full max-w-lg bg-gray-800 rounded-lg p-6">
          <div className="flex items-center gap-3">
            <AlertCircle size={40} />
            <div>
              <h2 className="text-lg font-semibold">Chatbot Not Found</h2>
              <p className="mt-1 text-sm">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-900 text-white">
      {/* header: compact on small screens, more detail on md+ */}
      <header className="sticky top-0 z-30 bg-gray-800/95 backdrop-blur-sm border-b border-gray-700">
        <div className="max-w-4xl mx-auto px-3 md:px-6 py-2 md:py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* hide the big logo on small screens to save vertical space */}
            <div className="hidden md:flex items-center gap-2 p-2 rounded-lg bg-indigo-700/10">
              <Sparkles />
              <Bot />
            </div>

            <div className="leading-tight">
              <h1 className="text-sm md:text-lg font-semibold truncate">{persona?.name || 'AI Assistant'}</h1>
              <p className="text-xs md:text-sm text-gray-400 truncate max-w-xs">{persona?.description || 'Powered by Gemini AI'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${isChatEnded ? 'bg-gray-500' : 'bg-green-400'}`} />
              <span className="text-xs text-gray-300">{isChatEnded ? 'Ended' : 'Online'}</span>
            </div>

            <button
              onClick={handleEndChat}
              className="hidden sm:inline-block px-3 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-sm"
            >
              End
            </button>
          </div>
        </div>
      </header>

      {/* messages area */}
      <main className="flex-1 overflow-auto px-3 md:px-6 py-3">
        <div className="max-w-4xl mx-auto flex flex-col gap-4">
          {isChatEnded && (
            <div className="text-center text-sm text-gray-400 bg-gray-800/50 rounded-md py-2">Conversation ended.</div>
          )}

          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {/* avatar */}
              {msg.role === 'assistant' && (
                <div className="order-1 md:order-1">
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gray-800 flex items-center justify-center">
                    <Zap size={16} />
                  </div>
                </div>
              )}

              <div className={`message-content max-w-[82%] ${msg.role === 'user' ? 'order-2 text-right self-end' : 'order-2 text-left self-start'}`}>
                <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                  <span className="font-medium">{msg.role === 'user' ? 'You' : persona?.name || 'AI'}</span>
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>

                <div className={`inline-block p-3 rounded-2xl shadow ${msg.role === 'user' ? 'bg-indigo-600 text-white ml-auto' : 'bg-gray-800/60 text-white'}`}>
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>
              </div>

              {msg.role === 'user' && (
                <div className="order-3 md:order-3">
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gray-800 flex items-center justify-center">
                    <User size={16} />
                  </div>
                </div>
              )}
            </div>
          ))}

          {isTyping && !isChatEnded && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center">
                <Zap size={16} />
              </div>

              <div className="max-w-[78%]">
                <div className="text-xs text-gray-400 mb-1">{persona?.name} <span className="ml-2 text-xs text-gray-400">typing…</span></div>
                <div className="inline-block p-3 rounded-2xl bg-gray-800/60">
                  <p className="whitespace-pre-wrap break-words">{typingText}<span className="ml-1">|</span></p>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* input: sticky bottom, respects safe-area inset */}
      {!isChatEnded && (
        <div className="sticky bottom-0 z-40 bg-gray-800/95 backdrop-blur-md border-t border-gray-700" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="max-w-4xl mx-auto px-3 md:px-6 py-3">
            <div className="flex items-end gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                className="flex-1 min-h-[44px] px-4 py-2 rounded-lg bg-gray-900/70 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={isLoading}
                aria-label="Message input"
              />

              <button
                onClick={handleSubmit}
                disabled={!input.trim() || isLoading}
                className="p-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 flex items-center justify-center"
                aria-label="Send message"
              >
                <Send size={18} />
              </button>

              <button
                onClick={handleEndChat}
                className="p-3 rounded-lg ml-1 bg-gray-700 hover:bg-gray-600"
                title="End Conversation"
                aria-label="End conversation"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-400 mt-2">Press <kbd className="px-1 py-0.5 rounded bg-gray-800">Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-gray-800">Shift + Enter</kbd> for new line</p>
          </div>
        </div>
      )}
    </div>
  );
}
