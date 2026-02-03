import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Drag handle icon
const GripIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
    <circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
  </svg>
);

interface SortableItemProps {
  id: string;
  children: React.ReactNode;
}

function SortableItem({ id, children }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.15)' : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="sortable-item" data-id={id}>
      <span 
        {...attributes} 
        {...listeners}
        className="drag-handle"
        style={{ cursor: 'grab', padding: '4px 8px', color: 'var(--muted-foreground)', display: 'inline-flex', alignItems: 'center' }}
        title="Drag to reorder"
      >
        <GripIcon />
      </span>
      {children}
    </div>
  );
}

interface TaskListIslandProps {
  taskIds: string[];
  uiKey: string | null;
  onReorderComplete?: () => void;
}

function TaskListIsland({ taskIds: initialIds, uiKey, onReorderComplete }: TaskListIslandProps) {
  const [items, setItems] = useState(initialIds);
  
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.indexOf(active.id as string);
    const newIndex = items.indexOf(over.id as string);
    const newItems = arrayMove(items, oldIndex, newIndex);
    
    setItems(newItems);
    
    // Calculate beforeTaskId
    const taskId = active.id as string;
    const beforeTaskId = newIndex + 1 < newItems.length ? newItems[newIndex + 1] : null;
    
    // Call reorder API
    const url = uiKey 
      ? `/ui/${uiKey}/swarm/tasks/${taskId}/reorder`
      : `/api/swarm/tasks/${taskId}/reorder`;
    
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beforeTaskId })
      });
      onReorderComplete?.();
    } catch (err) {
      console.error('Reorder failed:', err);
      // Revert on error
      setItems(initialIds);
    }
  }

  // Sync with external changes
  useEffect(() => {
    setItems(initialIds);
  }, [initialIds.join(',')]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {items.map((id) => {
          // Find the existing task card in the DOM and wrap it
          const existingCard = document.querySelector(`.task-card[data-id="${id}"]`);
          if (!existingCard) return null;
          
          return (
            <SortableItem key={id} id={id}>
              <div dangerouslySetInnerHTML={{ __html: existingCard.outerHTML }} />
            </SortableItem>
          );
        })}
      </SortableContext>
    </DndContext>
  );
}

// Mount function called from vanilla JS
declare global {
  interface Window {
    mountTaskListIsland: (containerId: string, taskIds: string[], uiKey: string | null) => void;
  }
}

window.mountTaskListIsland = function(containerId: string, taskIds: string[], uiKey: string | null) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('TaskListIsland: container not found:', containerId);
    return;
  }
  
  const root = createRoot(container);
  root.render(<TaskListIsland taskIds={taskIds} uiKey={uiKey} />);
};

export { TaskListIsland };
