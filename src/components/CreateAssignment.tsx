import React, { useState } from 'react';
import { Upload, X, Check } from 'lucide-react';

const CreateAssignment = ({ onCancel, onCreate }: { onCancel: () => void, onCreate: () => void }) => {
  const [rubrics, setRubrics] = useState({
    autoGrading: false,
    lateSubmissions: false,
    plagiarismCheck: false
  });

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Create Assignment</h1>
          <p className="text-muted-foreground mt-1">Create a new assignment for your students.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={onCancel}
            className="px-6 py-2.5 rounded-lg border bg-white text-sm font-semibold hover:bg-muted transition-colors shadow-sm"
          >
            Cancel
          </button>
          <button 
            onClick={onCreate}
            className="px-6 py-2.5 rounded-lg bg-[#1e3a8a] text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
          >
            Create Assignment
          </button>
        </div>
      </div>

      <div className="bg-card border rounded-2xl p-8 shadow-sm">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-6">
          {/* Left Column */}
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-foreground mb-2">Assignment Title <span className="text-red-500">*</span></label>
              <input 
                type="text" 
                placeholder="Enter title here..." 
                className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-foreground mb-2">Description</label>
              <textarea 
                rows={6}
                placeholder="Provide instructions for students..." 
                className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white resize-none"
              ></textarea>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">Class <span className="text-red-500">*</span></label>
                <select className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white appearance-none">
                  <option value="">Select class</option>
                  <option value="8a">Class 8-A</option>
                  <option value="9b">Class 9-B</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">Subject</label>
                <select className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white appearance-none">
                  <option value="">Select subject</option>
                  <option value="math">Mathematics</option>
                  <option value="science">Science</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">Due Date <span className="text-red-500">*</span></label>
                <input 
                  type="date" 
                  className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">Due Time</label>
                <input 
                  type="time" 
                  className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white"
                />
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-foreground mb-2">Total Points <span className="text-red-500">*</span></label>
              <input 
                type="number" 
                placeholder="100" 
                className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-foreground mb-2">Attachments</label>
              <div className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center bg-muted/5 hover:bg-muted/10 transition-colors cursor-pointer group">
                <Upload className="w-8 h-8 text-muted-foreground group-hover:text-primary transition-colors mb-3" />
                <p className="text-sm font-medium text-muted-foreground">
                  <span className="text-primary hover:underline">Drag and drop files here</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse (PDF, DOC, images)</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-foreground mb-2">Grading Rubric</label>
              <div className="space-y-3">
                {[
                  { id: 'autoGrading', label: 'Use automatic grading for MCQs' },
                  { id: 'lateSubmissions', label: 'Allow late submissions (penalty: -10%)' },
                  { id: 'plagiarismCheck', label: 'Enable plagiarism check' }
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setRubrics(prev => ({ ...prev, [option.id]: !prev[option.id as keyof typeof rubrics] }))}
                    className={`w-full flex items-center justify-between px-5 py-3.5 rounded-xl border transition-all text-sm font-medium ${
                      rubrics[option.id as keyof typeof rubrics] 
                        ? 'border-primary bg-primary/5 text-primary' 
                        : 'border-muted hover:border-primary/30 text-muted-foreground bg-white'
                    }`}
                  >
                    {option.label}
                    {rubrics[option.id as keyof typeof rubrics] && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-foreground mb-2">Notify Students</label>
              <div className="flex items-center gap-3 py-1">
                <div className="w-12 h-6 bg-primary rounded-full relative cursor-pointer">
                  <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
                </div>
                <span className="text-sm font-medium text-muted-foreground">Send notification to all students in class</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateAssignment;
