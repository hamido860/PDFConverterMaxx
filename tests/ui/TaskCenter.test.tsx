import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TaskCenter } from '../../src/components/TaskCenter';

// Mock the Supabase client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockSupabaseClient = { from: mockFrom };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabaseClient,
}));

function makeSupabaseResponse(data: any[]) {
  return Promise.resolve({ data, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockResolvedValue({ data: [], error: null });
});

describe('TaskCenter', () => {
  describe('when Supabase is disabled', () => {
    it('shows "No data found or Supabase disabled." message', () => {
      render(
        <TaskCenter
          supabaseUrl=""
          supabaseKey=""
          isSupabaseEnabled={false}
        />
      );
      expect(screen.getByText(/No data found or Supabase disabled/i)).toBeInTheDocument();
    });

    it('does NOT call Supabase when isSupabaseEnabled is false', () => {
      render(
        <TaskCenter
          supabaseUrl="https://example.supabase.co"
          supabaseKey="fake-key"
          isSupabaseEnabled={false}
        />
      );
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  describe('when Supabase is enabled', () => {
    it('shows loading spinner while fetching data', async () => {
      // Never resolve so loading stays true
      mockSelect.mockReturnValue(new Promise(() => {}));

      render(
        <TaskCenter
          supabaseUrl="https://example.supabase.co"
          supabaseKey="fake-key"
          isSupabaseEnabled={true}
        />
      );

      expect(screen.getByText(/Mapping hierarchy/i)).toBeInTheDocument();
    });

    it('calls Supabase when isSupabaseEnabled is true', async () => {
      render(
        <TaskCenter
          supabaseUrl="https://example.supabase.co"
          supabaseKey="fake-key"
          isSupabaseEnabled={true}
        />
      );

      await waitFor(() => {
        expect(mockFrom).toHaveBeenCalled();
      });
    });

    it('shows "No data found" when Supabase returns empty data', async () => {
      render(
        <TaskCenter
          supabaseUrl="https://example.supabase.co"
          supabaseKey="fake-key"
          isSupabaseEnabled={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/No data found or Supabase disabled/i)).toBeInTheDocument();
      });
    });

    it('renders tree nodes when data is returned', async () => {
      mockSelect.mockImplementation(() => {
        // Return curriculum on first call, empty for rest
        const call = mockFrom.mock.calls.length;
        if (call <= 1) {
          return makeSupabaseResponse([{ id: 'curr-1', name: 'Moroccan Curriculum' }]);
        }
        return makeSupabaseResponse([]);
      });

      mockFrom.mockImplementation((table: string) => {
        const responses: Record<string, any[]> = {
          curricula: [{ id: 'curr-1', name: 'Moroccan Curriculum' }],
          cycles: [],
          grades: [],
          grade_subjects: [],
          subjects: [],
          bac_sections: [],
          bac_tracks: [],
          bac_track_subjects: [],
        };
        return {
          select: () => makeSupabaseResponse(responses[table] ?? []),
        };
      });

      render(
        <TaskCenter
          supabaseUrl="https://example.supabase.co"
          supabaseKey="fake-key"
          isSupabaseEnabled={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Moroccan Curriculum')).toBeInTheDocument();
      });
    });
  });

  describe('tree navigation', () => {
    beforeEach(() => {
      mockFrom.mockImplementation((table: string) => {
        const responses: Record<string, any[]> = {
          curricula: [{ id: 'curr-1', name: 'Moroccan Curriculum' }],
          cycles: [{ id: 'cycle-1', name: 'Primary', curriculum_id: 'curr-1' }],
          grades: [{ id: 'grade-1', name: 'Grade 1', cycle_id: 'cycle-1' }],
          grade_subjects: [{ id: 'gs-1', grade_id: 'grade-1', subject_id: 'subj-1' }],
          subjects: [{ id: 'subj-1', name: 'Mathematics' }],
          bac_sections: [],
          bac_tracks: [],
          bac_track_subjects: [],
        };
        return {
          select: () => makeSupabaseResponse(responses[table] ?? []),
        };
      });
    });

    it('shows Task Tree label', async () => {
      render(
        <TaskCenter
          supabaseUrl="https://example.supabase.co"
          supabaseKey="fake-key"
          isSupabaseEnabled={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Task Tree')).toBeInTheDocument();
      });
    });

    it('shows "Select a node" prompt before any node is clicked', async () => {
      render(
        <TaskCenter
          supabaseUrl="https://example.supabase.co"
          supabaseKey="fake-key"
          isSupabaseEnabled={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Select a node')).toBeInTheDocument();
      });
    });

    it('expands curriculum node on click and shows cycle child', async () => {
      render(
        <TaskCenter
          supabaseUrl="https://example.supabase.co"
          supabaseKey="fake-key"
          isSupabaseEnabled={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Moroccan Curriculum')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Moroccan Curriculum'));

      await waitFor(() => {
        expect(screen.getByText('Primary')).toBeInTheDocument();
      });
    });
  });

  describe('Bac grade detection — Arabic name bug', () => {
    it('correctly detects Bac grade by Arabic name "البكالوريا"', async () => {
      // A grade named "البكالوريا" (Baccalaureate in Arabic) should be treated as Bac grade.
      // BUG: The source code contains a mojibake string 'Ø§Ù„Ø¨ÙƒØ§Ù„ÙˆØ±ÙŠØ§' instead of 'البكالوريا'.
      // This test WILL FAIL if the bug is present.
      mockFrom.mockImplementation((table: string) => {
        const responses: Record<string, any[]> = {
          curricula: [{ id: 'curr-1', name: 'Test Curriculum' }],
          cycles: [{ id: 'cycle-1', name: 'Secondary', curriculum_id: 'curr-1' }],
          grades: [{ id: 'grade-bac', name: 'البكالوريا', cycle_id: 'cycle-1' }],
          grade_subjects: [],
          subjects: [],
          bac_sections: [{ id: 'sec-1', name: 'Sciences' }],
          bac_tracks: [{ id: 'track-1', name: 'PC', section_id: 'sec-1' }],
          bac_track_subjects: [],
        };
        return {
          select: () => makeSupabaseResponse(responses[table] ?? []),
        };
      });

      render(
        <TaskCenter
          supabaseUrl="https://example.supabase.co"
          supabaseKey="fake-key"
          isSupabaseEnabled={true}
        />
      );

      // Expand curriculum to reveal cycle
      await waitFor(() => expect(screen.getByText('Test Curriculum')).toBeInTheDocument());
      fireEvent.click(screen.getByText('Test Curriculum'));

      // Expand cycle to reveal the Bac grade
      await waitFor(() => expect(screen.getByText('Secondary')).toBeInTheDocument());
      fireEvent.click(screen.getByText('Secondary'));

      // The Bac grade node must now be visible
      await waitFor(() => expect(screen.getByText('البكالوريا')).toBeInTheDocument());

      // Expand the Bac grade — if isBac detection works, sections appear as children.
      // BUG: source has mojibake 'Ø§Ù„Ø¨ÙƒØ§Ù„ÙˆØ±ÙŠØ§' instead of 'البكالوريا',
      // so isBac=false → grade treated as regular → sections NOT shown.
      fireEvent.click(screen.getByText('البكالوريا'));

      await waitFor(() => {
        expect(screen.getByText('Sciences')).toBeInTheDocument();
      });
    });
  });
});
