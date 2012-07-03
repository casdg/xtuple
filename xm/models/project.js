/*jslint bitwise: true, nomen: true, indent:2 */
/*global XT:true, XM:true, Backbone:true, _:true, console:true */

(function () {
  "use strict";

  /**
    @namespace
  
    A mixin shared by project models that share common project status
    functionality.
  */
  XM.ProjectStatus = {
    /** @scope XM.ProjectStatus */

    /**
    Returns project status as a localized string.
  
    @returns {String}
    */
    getProjectStatusString: function () {
      var K = XM.Project,
        status = this.get('status');
      if (status === K.CONCEPT) {
        return '_concept'.loc();
      }
      if (status === K.IN_PROCESS) {
        return '_inProcess'.loc();
      }
      if (status === K.COMPLETED) {
        return '_completed'.loc();
      }
    }

  };

  /**
    @class
  
    A base class shared by `XM.Project`,`XM.ProjectTask` and potentially other
    project related classes.
  
    @extends XM.Document
    @extends XM.ProjectStatus
  */
  XM.ProjectBase = XM.Document.extend({
    /** @scope XM.ProjectBase.prototype */

    defaults: function () {
      var K = XM.Project,
        result = { status: K.CONCEPT };
      return result;
    },

    privileges: {
      "all": {
        "create": "MaintainAllProjects",
        "read": "ViewAllProjects",
        "update": "MaintainAllProjects",
        "delete": "MaintainAllProjects"
      },
      "personal": {
        "create": "MaintainPersonalProjects",
        "read": "ViewPersonalProjects",
        "update": "MaintainPersonalProjects",
        "delete": "MaintainPersonalProjects",
        "properties": [
          "owner",
          "assignedTo"
        ]
      }
    },

    requiredAttributes: [
      "number",
      "status",
      "name",
      "dueDate"
    ],

    // ..........................................................
    // METHODS
    //

    initialize: function () {
      XM.Document.prototype.initialize.apply(this, arguments);
      this.on('change:status', this.projectStatusDidChange);
    },

    statusDidChange: function () {
      var K = XT.Model;
      if (this.getStatus() === K.READY_CLEAN) {
        this.setReadOnly('number');
      }
    },

    /**
    Reimplemented to handle automatic date setting.
    */
    projectStatusDidChange: function () {
      var status = this.get('status'),
        date,
        K = XM.Project;
      if (this.isDirty()) {
        date = new Date().toISOString();
        if (status === K.IN_PROCESS && !this.get('assignDate')) {
          this.set('assignDate', date);
        } else if (status === K.COMPLETED && !this.get('completeDate')) {
          this.set('completeDate', date);
        }
      }
    }

  });

  // Add in project status mixin
  XM.ProjectBase = XM.ProjectBase.extend(XM.ProjectStatus);

  /**
    @class
  
    @extends XM.ProjectBase
    @extends XM.ProjectStatusMixin
  */
  XM.Project = XM.ProjectBase.extend({
    /** @scope XM.Project.prototype */

    recordType: 'XM.Project',

    defaults: function () {
      var result = XM.ProjectBase.prototype.defaults.call(this);
      result.owner = result.assignedTo = XM.currentUser;
      return result;
    },

    relations: [{
      type: Backbone.HasOne,
      key: 'account',
      relatedModel: 'XM.AccountInfo'
    }, {
      type: Backbone.HasOne,
      key: 'contact',
      relatedModel: 'XM.ContactInfo'
    }, {
      type: Backbone.HasOne,
      key: 'owner',
      relatedModel: 'XM.UserAccountInfo'
    }, {
      type: Backbone.HasOne,
      key: 'assignedTo',
      relatedModel: 'XM.UserAccountInfo'
    }, {
      type: Backbone.HasMany,
      key: 'tasks',
      relatedModel: 'XM.ProjectTask',
      reverseRelation: {
        key: 'project'
      }
    }, {
      type: Backbone.HasMany,
      key: 'comments',
      relatedModel: 'XM.ProjectComment',
      reverseRelation: {
        key: 'project'
      }
    }, {
      type: Backbone.HasMany,
      key: 'accounts',
      relatedModel: 'XM.ProjectAccount',
      reverseRelation: {
        key: 'project'
      }
    }, {
      type: Backbone.HasMany,
      key: 'contacts',
      relatedModel: 'XM.ProjectContact',
      reverseRelation: {
        key: 'project'
      }
    }, {
      type: Backbone.HasMany,
      key: 'items',
      relatedModel: 'XM.ProjectItem',
      reverseRelation: {
        key: 'project'
      }
    }, {
      type: Backbone.HasMany,
      key: 'files',
      relatedModel: 'XM.ProjectFile',
      reverseRelation: {
        key: 'project'
      }
    }, {
      type: Backbone.HasMany,
      key: 'images',
      relatedModel: 'XM.ProjectImage',
      reverseRelation: {
        key: 'project'
      }
    }, {
      type: Backbone.HasMany,
      key: 'urls',
      relatedModel: 'XM.ProjectUrl',
      reverseRelation: {
        key: 'project'
      }
    }, {
      type: Backbone.HasMany,
      key: 'projects',
      relatedModel: 'XM.ProjectProject',
      reverseRelation: {
        key: 'project'
      }
    }, {
      type: Backbone.HasMany,
      key: 'recurrences',
      relatedModel: 'XM.ProjectRecurrence',
      reverseRelation: {
        key: 'project'
      }
    }],

    budgetedHoursTotal: 0.0,
    actualHoursTotal: 0.0,
    balanceHoursTotal: 0.0,
    budgetedExpensesTotal: 0.0,
    actualExpensesTotal: 0.0,
    balanceExpensesTotal: 0.0,

    // ..........................................................
    // METHODS
    //

    /**
    Return a copy of this project with a given number and date offset.
  
    @param {String} Project number
    @param {Offset} Days to offset due date(s).
    @returns {XM.Project}
    */
    copy: function (number, offset) {
      return XM.Project.copy(this, number, offset);
    },

    initialize: function () {
      XM.ProjectBase.prototype.initialize.apply(this, arguments);
      this.on('add:tasks remove:tasks', this.tasksDidChange);
    },

    /**
    Recaclulate task hours and expense totals.
    */
    tasksDidChange: function () {
      var that = this;
      this.budgetedHoursTotal = 0.0;
      this.actualHoursTotal = 0.0;
      this.budgetedExpensesTotal = 0.0;
      this.actualExpensesTotal = 0.0;

      // Total up task data
      _.each(this.get('tasks').models, function (task) {
        that.budgetedHoursTotal = XT.math.add(that.budgetedHoursTotal,
          task.get('budgetedHours'), XT.QTY_SCALE);
        that.actualHoursTotal = XT.math.add(that.actualHoursTotal,
          task.get('actualHours'), XT.QTY_SCALE);
        that.budgetedExpensesTotal = XT.math.add(that.budgetedExpensesTotal,
          task.get('budgetedExpenses'), XT.MONEY_SCALE);
        that.actualExpensesTotal = XT.math.add(that.actualExpensesTotal,
          task.get('actualExpenses'), XT.MONEY_SCALE);
      });

      this.actualHoursBalance = XT.math.subtract(this.budgetedHoursTotal,
        this.actualHoursTotal, XT.QTY_SCALE);
      this.balanceExpensesTotal = XT.math.subtract(this.budgetedExpensesTotal,
        this.actualExpensesTotal, XT.QTY_SCALE);
    }

  });

  // ..........................................................
  // CLASS METHODS
  //

  _.extend(XM.Project, {
    /** @scope XM.Project */

    /**
    Return a copy of this project with a given number and date offset.

    @param {XM.Project} Project
    @param {String} Project number
    @param {Number} Due date offset
    @return {XM.Project} copy of the project
    */
    copy: function (project, number, offset) {
      if ((project instanceof XM.Project) === false) {
        console.log("Passed object must be an instance of 'XM.Project'");
        return false;
      }
      if (number === undefined) {
        console.log("Number is required");
        return false;
      }
      var obj,
        prop,
        i,
        dueDate = new Date(project.get('dueDate').valueOf()),
        idAttribute = XM.Project.prototype.idAttribute,
        result;
      offset = offset || 0;
      dueDate.setDate(dueDate.getDate() + offset);

      // Deep copy the project and fix up
      obj = project.parse(JSON.parse(JSON.stringify(project.toJSON())));
      _.extend(obj, {
        number: number,
        dueDate: dueDate
      });
      delete obj[idAttribute];
      delete obj.status;
      delete obj.comments;
      delete obj.recurrences;

      // Fix up tasks
      idAttribute = XM.ProjectTask.prototype.idAttribute;
      if (obj.tasks) {
        _.each(obj.tasks, function (task) {
          delete task[idAttribute];
          delete task.status;
          delete task.comments;
          delete task.alarms;
          dueDate = new Date(task.dueDate.valueOf());
          dueDate.setDate(dueDate.getDate() + offset);
        });
      }

      // Fix up remaining arrays
      for (prop in obj) {
        if (obj.hasOwnProperty(prop)  && prop !== 'tasks' &&
            _.isArray(obj[prop])) {
          idAttribute = project.get(prop).model.prototype.idAttribute;
          for (i = 0; i < obj[prop].length; i += 1) {
            delete obj[prop][i][idAttribute];
          }
        }
      }

      result = new XM.Project(obj, {isNew: true});
      result.documentKeyDidChange();
      return result;
    },

    // ..........................................................
    // CONSTANTS
    //

    /**
      Concept status for project.

      @static
      @constant
      @type String
      @default P
    */
    CONCEPT: 'P',

    /**
      In-Process status for project.

      @static
      @constant
      @type String
      @default O
    */
    IN_PROCESS: 'O',

    /**
      Completed status for project.
      @static
      @constant
      @type String
      @default C
    */
    COMPLETED: 'C'

  });

  /**
    @class
  
    @extends XM.ProjectBase
    @extends XM.ProjectStatusMixin
  */
  XM.ProjectTask = XM.ProjectBase.extend({
    /** @scope XM.ProjectTask.prototype */

    recordType: 'XM.ProjectTask',

    defaults: function () {
      var result = XM.ProjectBase.prototype.defaults.call(this);
      _.extend(result, {
        actualExpenses: 0,
        actualHours: 0,
        budgetedExpenses: 0,
        budgetedHours: 0
      });
      return result;
    },

    relations: [{
      type: Backbone.HasOne,
      key: 'owner',
      relatedModel: 'XM.UserAccountInfo'
    }, {
      type: Backbone.HasOne,
      key: 'assignedTo',
      relatedModel: 'XM.UserAccountInfo'
    }, {
      type: Backbone.HasMany,
      key: 'comments',
      relatedModel: 'XM.ProjectTaskComment',
      reverseRelation: {
        key: 'projectTask'
      }
    }],

    // ..........................................................
    // METHODS
    //

    initialize: function () {
      XM.ProjectBase.prototype.initialize.apply(this, arguments);
      var event = 'change:budgetedHours change:actualHours ' +
                  'change:budgetedExpenses change:actualExpenses';
      this.on(event, this.valuesDidChange);
      this.on('change:project', this.projectDidChange);
    },

    /**
      Set defaults from project.
    */
    projectDidChange: function () {
      var project = this.get('project'),
        K = XT.Model,
        status = this.getStatus();
      if (project && status === K.READY_NEW) {
        this.set('owner', this.get('owner') || project.get('owner'));
        this.set('assignedTo', this.get('owner') || project.get('assignedTo'));
        this.set('startDate', this.get('startDate') || project.get('startDate'));
        this.set('assignDate', this.get('assignDate') || project.get('assignDate'));
        this.set('dueDate', this.get('dueDate') || project.get('dueDate'));
        this.set('completeDate', this.get('completeDate') || project.get('completeDate'));
      }
    },

    /**
      Update project totals when values change.
    */
    valuesDidChange: function () {
      var project = this.get('project');
      if (project) { project.tasksDidChange(); }
    }

  });

  /**
    @class
  
    @extends XM.Comment
  */
  XM.ProjectComment = XM.Comment.extend({
    /** @scope XM.ProjectComment.prototype */

    recordType: 'XM.ProjectComment'

  });

  /**
    @class
  
    @extends XT.Model
  */
  XM.ProjectAccount = XT.Model.extend({
    /** @scope XM.ProjectAccount.prototype */

    recordType: 'XM.ProjectAccount',

    isDocumentAssignment: true,

    relations: [{
      type: Backbone.HasOne,
      key: 'account',
      relatedModel: 'XM.AccountInfo'
    }]

  });

  /**
    @class
  
    @extends XT.Model
  */
  XM.ProjectContact = XT.Model.extend({
    /** @scope XM.ProjectContact.prototype */

    recordType: 'XM.ProjectContact',

    isDocumentAssignment: true,

    relations: [{
      type: Backbone.HasOne,
      key: 'contact',
      relatedModel: 'XM.ContactInfo'
    }]

  });

  /**
    @class
  
    @extends XT.Model
  */
  XM.ProjectItem = XT.Model.extend({
    /** @scope XM.ProjectItem.prototype */

    recordType: 'XM.ProjectItem',

    isDocumentAssignment: true,

    relations: [{
      type: Backbone.HasOne,
      key: 'item',
      relatedModel: 'XM.ItemInfo'
    }]

  });

  /**
    @class
  
    @extends XT.Model
  */
  XM.ProjectFile = XT.Model.extend({
    /** @scope XM.ProjectFile.prototype */

    recordType: 'XM.ProjectFile',

    isDocumentAssignment: true,

    relations: [{
      type: Backbone.HasOne,
      key: 'file',
      relatedModel: 'XM.FileInfo'
    }]

  });

  /**
    @class
  
    @extends XT.Model
  */
  XM.ProjectImage = XT.Model.extend({
    /** @scope XM.ProjectImage.prototype */

    recordType: 'XM.ProjectImage',

    isDocumentAssignment: true,

    relations: [{
      type: Backbone.HasOne,
      key: 'image',
      relatedModel: 'XM.ImageInfo'
    }]

  });

  /**
    @class
  
    @extends XT.Model
  */
  XM.ProjectUrl = XT.Model.extend({
    /** @scope XM.ProjectUrl.prototype */

    recordType: 'XM.ProjectUrl',

    isDocumentAssignment: true,

    relations: [{
      type: Backbone.HasOne,
      key: 'url',
      relatedModel: 'XM.Url'
    }]

  });

  /**
    @class
  
    @extends XT.Model
  */
  XM.ProjectProject = XT.Model.extend({
    /** @scope XM.ProjectProject.prototype */

    recordType: 'XM.ProjectProject',

    isDocumentAssignment: true,

    relations: [{
      type: Backbone.HasOne,
      key: 'project',
      relatedModel: 'XM.ProjectInfo'
    }]

  });

  /**
    @class
  
    @extends XT.Model
  */
  XM.ProjectRecurrence = XT.Model.extend({
    /** @scope XM.ProjectRecurrence.prototype */

    recordType: 'XM.ProjectRecurrence'

  });

  /**
    @class
  
    @extends XM.Comment
  */
  XM.ProjectTaskComment = XM.Comment.extend({
    /** @scope XM.ProjectTaskComment.prototype */

    recordType: 'XM.ProjectTaskComment'

  });

  /**
    @class
  
    @extends XM.Alarm
  */
  XM.ProjectTaskAlarm = XM.Alarm.extend({
    /** @scope XM.ProjectTaskAlarm.prototype */

    recordType: 'XM.ProjectTaskAlarm'

  });


  /**
    @class
  
    @extends XT.Model
    @extends XM.ProjectStatus
  */
  XM.ProjectInfo = XT.Model.extend({
    /** @scope XM.ProjectInfo.prototype */

    recordType: 'XM.ProjectInfo',

    readOnly: true,

    relations: [{
      type: Backbone.HasOne,
      key: 'account',
      relatedModel: 'XM.AccountInfo'
    }, {
      type: Backbone.HasOne,
      key: 'owner',
      relatedModel: 'XM.UserAccountInfo'
    }, {
      type: Backbone.HasOne,
      key: 'assignedTo',
      relatedModel: 'XM.UserAccountInfo'
    }]

  });

  XM.ProjectInfo = XM.ProjectInfo.extend(XM.ProjectStatus);

  // ..........................................................
  // COLLECTIONS
  //

  /**
    @class
  
    @extends XT.Collection
  */
  XM.ProjectInfoCollection = XT.Collection.extend({
    /** @scope XM.ProjectInfoCollection.prototype */

    model: XM.ProjectInfo

  });

}());
