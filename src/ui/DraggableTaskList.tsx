// React island for draggable task list using dnd-kit
import React, { useState, useEffect, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createRoot } from 'react-dom/client';

interface TaskItem {
  id: string;
}

interface SortableTaskProps {
  id: string;
  children: React.ReactNode;
}

function SortableTask({ id, children }: SortableTaskProps) {
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
    position: 'relative' as const,
  };

  return (
    <div ref={setNodeRef} style={style} data-sortable-id={id}>
      <div 
        className="drag-handle" 
        {...attributes} 
        {...listeners}
        style={{ 
          position: 'absolute',
          left: '8px',
          top: '50%',
          transform: 'translateY(-50%)',
          cursor: 'grab', 
          padding: '8px', 
          color: 'var(--muted-foreground)',
          zIndex: 10,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="5" r="1"/>
          <circle cx="9" cy="12" r="1"/>
          <circle cx="9" cy="19" r="1"/>
          <circle cx="15" cy="5" r="1"/>
          <circle cx="15" cy="12" r="1"/>
          <circle cx="15" cy="19" r="1"/>
        </svg>
      </div>
      {children}
    </div>
  );
}

interface DraggableTaskListProps {
  taskIds: string[];
  renderTask: (id: string) => React.ReactNode;
  onReorder: (taskId: string, beforeTaskId: string | null) => void;
}

export function DraggableTaskList({ taskIds: initialIds, renderTask, onReorder }: DraggableTaskListProps) {
  const [taskIds, setTaskIds] = useState(initialIds);
  
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = taskIds.findIndex((id) => id === active.id);
      const newIndex = taskIds.findIndex((id) => id === over.id);
      
      const newIds = arrayMove(taskIds, oldIndex, newIndex);
      setTaskIds(newIds);
      
      // Calculate beforeTaskId (the task after the moved task in new position)
      const beforeTaskId = newIndex + 1 < newIds.length ? newIds[newIndex + 1] : null;
      onReorder(active.id as string, beforeTaskId);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div className="task-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {taskIds.map((id) => (
            <SortableTask key={id} id={id}>
              {renderTask(id)}
            </SortableTask>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// Simpler mount that works with existing DOM
export function initDndKit(
  container: HTMLElement,
  onReorder: (taskId: string, beforeTaskId: string | null) => void
) {
  // Get existing task cards
  const existingCards = container.querySelectorAll('.task-card');
  const taskIds = Array.from(existingCards).map(card => card.getAttribute('data-id') || '').filter(Boolean);
  
  // Store original HTML for each task
  const taskHtmlMap = new Map<string, string>();
  existingCards.forEach(card => {
    const id = card.getAttribute('data-id');
    if (id) {
      taskHtmlMap.set(id, card.outerHTML);
    }
  });
  
  // Clear container and mount React
  const root = createRoot(container);
  
  const renderTask = (id: string) => {
    const html = taskHtmlMap.get(id) || '';
    return <div dangerouslySetInnerHTML={{ __html: html }} style={{ paddingLeft: '32px' }} />;
  };
  
  root.render(
    <DraggableTaskList 
      taskIds={taskIds} 
      renderTask={renderTask} 
      onReorder={onReorder} 
    />
  );
  
  return () => root.unmount();
}

// Expose to window
if (typeof window !== 'undefined') {
  (window as any).initDndKit = initDndKit;
}
