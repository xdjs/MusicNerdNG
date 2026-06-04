"use client";

import { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AdminTabsProps {
  ugcContent: ReactNode;
  usersContent: ReactNode;
  claimsContent: ReactNode;
  mcpKeysContent: ReactNode;
  agentWorkContent: ReactNode;
  artistDataContent: ReactNode;
  ugcCount: number;
  claimsCount: number;
}

export default function AdminTabs({
  ugcContent,
  usersContent,
  claimsContent,
  mcpKeysContent,
  agentWorkContent,
  artistDataContent,
  ugcCount,
  claimsCount,
}: AdminTabsProps) {
  return (
    <Tabs defaultValue="ugc">
      <TabsList>
        <TabsTrigger value="ugc">
          UGC ({ugcCount})
        </TabsTrigger>
        <TabsTrigger value="claims">
          Claims ({claimsCount})
        </TabsTrigger>
        <TabsTrigger value="artist-data">Artist Data</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="mcp-keys">MCP Keys</TabsTrigger>
        <TabsTrigger value="agent-work">Agent Work</TabsTrigger>
      </TabsList>
      <TabsContent value="ugc">{ugcContent}</TabsContent>
      <TabsContent value="claims">{claimsContent}</TabsContent>
      <TabsContent value="artist-data">{artistDataContent}</TabsContent>
      <TabsContent value="users">{usersContent}</TabsContent>
      <TabsContent value="mcp-keys">{mcpKeysContent}</TabsContent>
      <TabsContent value="agent-work">{agentWorkContent}</TabsContent>
    </Tabs>
  );
}
