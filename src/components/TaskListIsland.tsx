import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
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

interface TaskCardData {
  id: string;
  html: string;
}

function SortableTaskCard({ id, html }: TaskCardData) {
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
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="sortable-wrapper">
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <span 
          {...attributes} 
          {...listeners}
          className="drag-handle"
          style={{ 
            cursor: 'grab', 
            padding: '16px 8px 16px 0', 
            color: 'var(--muted-foreground)',
            flexShrink: 0,
          }}
          title="Drag to reorder"
        >
          <GripIcon />
        </span>
        <div style={{ flex: 1 }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

interface TaskListIslandProps {
  tasks: TaskCardData[];
  uiKey: string | null;
}

function TaskListIsland({ tasks: initialTasks, uiKey }: TaskListIslandProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = tasks.findIndex(t => t.id === active.id);
    const newIndex = tasks.findIndex(t => t.id === over.id);
    const newTasks = arrayMove(tasks, oldIndex, newIndex);
    
    setTasks(newTasks);
    
    // Calculate beforeTaskId
    const taskId = active.id as string;
    const beforeTaskId = newIndex + 1 < newTasks.length ? newTasks[newIndex + 1].id : null;
    
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
    } catch (err) {
      console.error('Reorder failed:', err);
      setTasks(initialTasks); // Revert on error
    }
  }

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  return (
    <DndContext 
      sensors={sensors} 
      collisionDetection={closestCenter} 
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} {...task} />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeTask ? (
          <div style={{ opacity: 0.8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
            <div dangerouslySetInnerHTML={{ __html: activeTask.html }} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// Mount function called from vanilla JS
declare global {
  interface Window {
    mountTaskListIsland: (containerId: string, tasks: TaskCardData[], uiKey: string | null) => void;
    unmountTaskListIsland: (containerId: string) => void;
    taskListRoots: Map<string, ReturnType<typeof createRoot>>;
  }
}

window.taskListRoots = new Map();

window.mountTaskListIsland = function(containerId: string, tasks: TaskCardData[], uiKey: string | null) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('TaskListIsland: container not found:', containerId);
    return;
  }
  
  // Unmount existing if any
  const existingRoot = window.taskListRoots.get(containerId);
  if (existingRoot) {
    existingRoot.unmount();
  }
  
  const root = createRoot(container);
  window.taskListRoots.set(containerId, root);
  root.render(<TaskListIsland tasks={tasks} uiKey={uiKey} />);
};

window.unmountTaskListIsland = function(containerId: string) {
  const root = window.taskListRoots.get(containerId);
  if (root) {
    root.unmount();
    window.taskListRoots.delete(containerId);
  }
};

export { TaskListIsland };
