"use client"

import { useState, FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function AgentPage() {
  const [artist, setArtist] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!artist || !question) return;
    setLoading(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ artist, question }),
      });
      const data = await res.json();
      setAnswer(data.answer ?? data.error ?? "Something went wrong");
    } catch (err) {
      setAnswer("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-10 space-y-6">
      <h1 className="text-3xl font-bold text-center text-black">MusicNerd Agent</h1>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="artist">Artist Name</Label>
          <Input
            id="artist"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="e.g. Beyoncé"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="question">Your Question</Label>
          <Textarea
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What is this artist's Twitter?"
          />
        </div>

        <Button type="submit" disabled={loading}>
          {loading ? "Thinking..." : "Ask"}
        </Button>
      </form>

      {answer && (
        <div className="bg-white p-4 rounded-lg shadow-md">
          <h2 className="font-semibold mb-2">Answer</h2>
          <p>{answer}</p>
        </div>
      )}
    </div>
  );
} 