import { useState, useEffect } from "react";
import { Plus, Trash2, Pencil, Check, X, Search, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motion, AnimatePresence } from "framer-motion";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Modal } from "@/components/Modal";
import { toast } from "sonner";
import { authFetch } from "../lib/authFetch";
import { createPortal } from "react-dom";

interface Room {
  room_id: number;
  room_number: string;
  capacity: number;
  type: string;
}

interface RoomFormValues {
  room_number: string;
  capacity: number;
  type: string;
}

interface RoomFormProps {
  initial: RoomFormValues;
  onSave: (values: RoomFormValues) => void;
  onCancel: () => void;
  stacked?: boolean;
}

function RoomForm({ initial, onSave, onCancel, stacked }: RoomFormProps) {
  const [roomNumber, setRoomNumber] = useState(initial.room_number);
  const [capacity, setCapacity] = useState(String(initial.capacity));
  const [type, setType] = useState(initial.type);
  const [error, setError] = useState("");

  const handleSave = () => {
    if (!roomNumber.trim()) {
      setError("Room number is required.");
      return;
    }
    const capNum = Number(capacity);
    if (
      !capacity.trim() ||
      isNaN(capNum) ||
      capNum <= 0 ||
      !Number.isInteger(capNum)
    ) {
      setError("Capacity must be a whole number greater than 0.");
      return;
    }
    setError("");
    onSave({ room_number: roomNumber, capacity: capNum, type });
  };
  return (
    <div className="space-y-4">
      <div className={stacked ? "grid gap-4" : "grid grid-cols-3 gap-4"}>
        <Input
          placeholder="Room Number (e.g. 301)"
          value={roomNumber}
          onChange={(e) => setRoomNumber(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <Input
          type="number"
          placeholder="Capacity"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="Lecture">Lecture</option>
          <option value="Laboratory">Laboratory</option>
          <option value="PE">PE</option>
        </select>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave}>
          <Check className="w-4 h-4 mr-1" /> Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="!bg-white hover:!bg-accent"
          onClick={onCancel}
        >
          <X className="w-4 h-4 mr-1" /> Cancel
        </Button>
      </div>
    </div>
  );
}

export function RoomsView() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Room | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");

  const emptyRoom: RoomFormValues = {
    room_number: "",
    capacity: 30,
    type: "Lecture",
  };

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rooms");
      const data = await res.json();
      setRooms(data);
    } catch (err) {
      console.error("Failed to fetch rooms", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  const handleSubmit = async (values: RoomFormValues) => {
    if (!values.room_number) return;
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not add the room.");
        return;
      }
      setShowForm(false);
      fetchRooms();
    } catch (err) {
      console.error("Failed to create room", err);
      toast.error("Could not add the room.");
    }
  };

  const startEdit = (r: Room) => {
    setEditingId(r.room_id);
    setShowForm(false);
  };

  const saveEdit = async (values: RoomFormValues) => {
    if (!editingId || !values.room_number) return;
    try {
      const res = await fetch(`/api/rooms/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not update the room.");
        return;
      }
      setEditingId(null);
      fetchRooms();
    } catch (err) {
      console.error("Failed to update room", err);
      toast.error("Could not update the room.");
    }
  };
  const cancelEdit = () => {
    setEditingId(null);
  };

  const removeRoom = async (id: number) => {
    try {
      const res = await fetch(`/api/rooms/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to delete room");
        return;
      }
      setSelected((s) => s.filter((x) => x !== id));
      fetchRooms();
    } catch (err) {
      console.error("Failed to delete room", err);
      toast.error("Failed to delete room");
    }
  };

  const toggleSelect = (id: number) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  const removeSelected = async () => {
    const ids = [...selected];
    const failed: number[] = [];
    let firstError = "";
    for (const id of ids) {
      try {
        const res = await fetch(`/api/rooms/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failed.push(id);
          if (!firstError) firstError = data.error ?? "";
        }
      } catch {
        failed.push(id);
      }
    }
    const deleted = ids.length - failed.length;
    if (deleted > 0) {
      toast.success(`Deleted ${deleted} room${deleted !== 1 ? "s" : ""}`);
    }
    if (failed.length > 0) {
      const names = rooms
        .filter((r) => failed.includes(r.room_id))
        .map((r) => r.room_number)
        .join(", ");
      toast.error(
        `Could not delete ${names}${firstError ? `: ${firstError}` : ""}`,
      );
    }
    setSelected(failed);
    fetchRooms();
  };

  const filtered = rooms.filter((r) => {
    if (typeFilter && r.type !== typeFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.room_number.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q)
    );
  });
  const sorted = [...filtered].sort((a, b) =>
    a.room_number.localeCompare(b.room_number, undefined, { numeric: true }),
  );

  const editingRoom = rooms.find((r) => r.room_id === editingId);

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-50 bg-background pt-4 pb-4 -mx-6 px-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-heading text-2xl font-bold">Rooms</h2>
            <p className="text-muted-foreground mt-1">
              Classrooms and laboratories
            </p>
          </div>
          <Button
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> Add Room
          </Button>
        </div>

        <div className="glass-card rounded-xl p-4 flex gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search room number or type…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setEditingId(null);
              }}
              className="pl-9"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All types</option>
            <option value="Lecture">Lecture</option>
            <option value="Laboratory">Laboratory</option>
            <option value="PE">PE</option>
          </select>
        </div>
      </div>

      {!loading && filtered.length === 0 && (
        <div className="glass-card rounded-xl p-10 text-center text-sm text-muted-foreground">
          {rooms.length === 0 ? (
            <>
              No rooms yet. Click <strong>Add Room</strong> to input the rooms
              available in STI Malolos.
            </>
          ) : (
            "No rooms match your search."
          )}
        </div>
      )}

      {sorted.length > 0 && (
        <div className="glass-card rounded-xl max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-xs font-semibold text-muted-foreground">
              <tr className="border-b">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={
                      sorted.length > 0 && selected.length === sorted.length
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? sorted.map((r) => r.room_id) : [],
                      )
                    }
                    aria-label="Select all rooms"
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                </th>
                <th className="px-4 py-3 text-left">Room</th>
                <th className="px-4 py-3 text-left">Capacity</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-0 text-right whitespace-nowrap">
                  {selected.length > 0 && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 px-2 text-xs"
                      onClick={() => setBulkDeleteOpen(true)}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete (
                      {selected.length})
                    </Button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {sorted.map((r) => (
                  <motion.tr
                    key={r.room_id}
                    initial={search ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`border-b last:border-0 hover:bg-muted/40 ${
                      selected.includes(r.room_id) ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.includes(r.room_id)}
                        onChange={() => toggleSelect(r.room_id)}
                        aria-label={`Select room ${r.room_number}`}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">{r.room_number}</td>
                    <td className="px-4 py-3">{r.capacity}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {r.type}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startEdit(r)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(r)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Add Room"
      >
        <RoomForm
          stacked
          initial={emptyRoom}
          onSave={handleSubmit}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      <Modal open={!!editingRoom} onClose={cancelEdit} title="Edit Room">
        {editingRoom && (
          <RoomForm
            stacked
            initial={{
              room_number: editingRoom.room_number,
              capacity: editingRoom.capacity,
              type: editingRoom.type,
            }}
            onSave={saveEdit}
            onCancel={cancelEdit}
          />
        )}
      </Modal>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title="Delete this room?"
        description={`Are you sure you want to delete ${deleteTarget?.room_number}?`}
        onConfirm={() => {
          if (deleteTarget) removeRoom(deleteTarget.room_id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDeleteDialog
        open={bulkDeleteOpen}
        title={`Delete ${selected.length} selected room${selected.length !== 1 ? "s" : ""}?`}
        description="Rooms used by scheduled classes can't be deleted and will stay selected."
        onConfirm={() => {
          setBulkDeleteOpen(false);
          removeSelected();
        }}
        onCancel={() => setBulkDeleteOpen(false)}
      />
      {loading &&
        createPortal(
          <div
            role="status"
            aria-busy="true"
            className="fixed inset-y-0 right-0 left-64 z-[60] flex cursor-wait items-center justify-center bg-gray-200/60"
          >
            <div className="flex items-center gap-3 rounded-lg bg-white px-5 py-3 shadow-md">
              <Loader2 className="h-5 w-5 animate-spin text-gray-700" />
              <span className="text-sm text-gray-700">Loading...</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
