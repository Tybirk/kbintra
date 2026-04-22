import { describe, it, expect, beforeEach, vi } from "vitest"

import { saveDraft, loadDraft, clearDraft } from "./draftStorage"

describe("draftStorage", () => {
  beforeEach(() => {
    localStorage.clear()

    // Reset the cached key so each test starts fresh

    vi.resetModules()
  })

  describe("saveDraft / loadDraft roundtrip", () => {
    it("saves and loads plain text content", async () => {
      await saveDraft("key1", "<p>Hej verden</p>")

      const result = await loadDraft("key1")

      expect(result).toBe("<p>Hej verden</p>")
    })

    it("saves and loads content with special characters", async () => {
      const content = "<p>Møde på torsdag — æøå!</p>"

      await saveDraft("key2", content)

      const result = await loadDraft("key2")

      expect(result).toBe(content)
    })

    it("saves and loads multiline HTML content", async () => {
      const content = "<p>Linje 1</p><p>Linje 2</p>"

      await saveDraft("key3", content)

      const result = await loadDraft("key3")

      expect(result).toBe(content)
    })

    it("different keys are stored independently", async () => {
      await saveDraft("key-a", "<p>Indhold A</p>")

      await saveDraft("key-b", "<p>Indhold B</p>")

      expect(await loadDraft("key-a")).toBe("<p>Indhold A</p>")

      expect(await loadDraft("key-b")).toBe("<p>Indhold B</p>")
    })

    it("overwrites previous draft for the same key", async () => {
      await saveDraft("key4", "<p>Første udkast</p>")

      await saveDraft("key4", "<p>Andet udkast</p>")

      const result = await loadDraft("key4")

      expect(result).toBe("<p>Andet udkast</p>")
    })
  })

  describe("empty content is not saved", () => {
    it("does not save empty string", async () => {
      await saveDraft("key5", "")

      expect(await loadDraft("key5")).toBeNull()
    })

    it("does not save <p></p>", async () => {
      await saveDraft("key6", "<p></p>")

      expect(await loadDraft("key6")).toBeNull()
    })

    it("does not save <p><br></p>", async () => {
      await saveDraft("key7", "<p><br></p>")

      expect(await loadDraft("key7")).toBeNull()
    })

    it("clears existing draft when saving empty content", async () => {
      await saveDraft("key8", "<p>Noget indhold</p>")

      expect(await loadDraft("key8")).not.toBeNull()

      await saveDraft("key8", "<p></p>")

      expect(await loadDraft("key8")).toBeNull()
    })
  })

  describe("loadDraft", () => {
    it("returns null when key does not exist", async () => {
      expect(await loadDraft("nonexistent")).toBeNull()
    })
  })

  describe("clearDraft", () => {
    it("removes the stored draft", async () => {
      await saveDraft("key9", "<p>Skal slettes</p>")

      expect(await loadDraft("key9")).not.toBeNull()

      clearDraft("key9")

      expect(await loadDraft("key9")).toBeNull()
    })

    it("is a no-op when key does not exist", () => {
      expect(() => clearDraft("does-not-exist")).not.toThrow()
    })
  })
})
