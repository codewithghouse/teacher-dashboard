import React, { useState } from 'react';
import { X, Check, Plus } from 'lucide-react';

const CreateTest = ({ onCancel, onCreate }: { onCancel: () => void, onCreate: () => void }) => {
  const [topics, setTopics] = useState([
    "Algebraic Expressions",
    "Linear Equations",
    "Quadratic Equations",
    "Polynomials"
  ]);

  const [questionTypes, setQuestionTypes] = useState([
    { label: "MCQ", selected: true },
    { label: "Short Answer", selected: true },
    { label: "Long Answer", selected: true }
  ]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Create Test</h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">Set up a new test for your class.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={onCancel}
            className="px-6 py-2.5 rounded-lg border bg-white text-sm font-bold text-foreground hover:bg-muted transition-colors shadow-sm"
          >
            Cancel
          </button>
          <button 
            onClick={onCreate}
            className="px-6 py-2.5 rounded-lg bg-[#1e3a8a] text-white text-sm font-bold hover:opacity-90 transition-opacity shadow-sm"
          >
            Create Test
          </button>
        </div>
      </div>

      <div className="bg-card border rounded-2xl p-8 shadow-sm">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-7">
          {/* Left Column */}
          <div className="space-y-7">
            <div>
              <label className="block text-sm font-bold text-foreground mb-2.5">Test Name <span className="text-red-500">*</span></label>
              <input 
                type="text" 
                placeholder="Enter test name..." 
                className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white font-medium"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-foreground mb-2.5">Description</label>
              <textarea 
                rows={5}
                placeholder="Describe what this test covers..." 
                className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white resize-none font-medium"
              ></textarea>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-foreground mb-2.5">Class <span className="text-red-500">*</span></label>
                <select className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white appearance-none font-medium">
                  <option value="">Select class</option>
                  <option value="8a">Class 8-A</option>
                  <option value="9b">Class 9-B</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-foreground mb-2.5">Subject</label>
                <select className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white appearance-none font-medium">
                  <option value="">Select subject</option>
                  <option value="math">Mathematics</option>
                  <option value="science">Science</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-bold text-foreground mb-2.5">Test Date <span className="text-red-500">*</span></label>
                <input 
                  type="date" 
                  className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white font-medium"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-foreground mb-2.5">Duration <span className="text-red-500">*</span></label>
                <input 
                  type="text" 
                  placeholder="e.g. 60 mins"
                  className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white font-medium"
                />
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-7">
            <div>
              <label className="block text-sm font-bold text-foreground mb-2.5">Total Marks <span className="text-red-500">*</span></label>
              <input 
                type="number" 
                placeholder="50" 
                className="w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all bg-white font-medium"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-foreground mb-2.5">Topics Covered</label>
              <div className="space-y-2">
                {topics.map((topic, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-3 rounded-xl border bg-muted/5 group hover:border-primary/30 transition-all">
                    <span className="text-sm font-semibold text-foreground">{topic}</span>
                    <button className="text-muted-foreground hover:text-red-500 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button className="w-full py-2.5 rounded-xl border border-dashed text-sm font-bold text-primary hover:bg-primary/5 transition-all flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Add Topic
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-foreground mb-2.5">Question Types</label>
              <div className="flex flex-wrap gap-2.5">
                {questionTypes.map((type, i) => (
                  <button
                    key={i}
                    className={`px-5 py-2 rounded-full text-xs font-bold transition-all border ${
                      type.selected 
                        ? 'bg-edu-light-blue text-primary border-primary/20' 
                        : 'bg-white text-muted-foreground border-muted hover:border-primary/20 hover:text-primary'
                    }`}
                  >
                    {type.label}
                  </button>
                ))}
                <button className="px-4 py-2 rounded-full border border-dashed text-xs font-bold text-muted-foreground hover:bg-muted/5 flex items-center gap-1.5 transition-all">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-foreground mb-2.5">Additional Settings</label>
              <div className="space-y-3.5 mt-1">
                {[
                  "Show results to students immediately",
                  "Allow retake for failed students",
                  "Shuffle questions for each student"
                ].map((setting, i) => (
                  <div key={i} className="flex items-center gap-3 group cursor-pointer">
                    <div className="w-5 h-5 rounded border border-muted flex items-center justify-center group-hover:border-primary/50 transition-colors">
                      <Check className="w-3.5 h-3.5 text-primary opacity-30 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <span className="text-sm font-semibold text-muted-foreground group-hover:text-foreground transition-colors">{setting}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateTest;
